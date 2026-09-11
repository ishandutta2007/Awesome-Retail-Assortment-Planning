const fs = require('fs');

// GIF89a minimal pure-JS encoder for fixed palette
function writeGIF(filename, width, height, frames, delay = 20) {
  // frames is array of Uint8Array(width * height) indices into a 256 color palette
  // palette is array of [r, g, b]
  const palette = [];
  // Build a 64-color palette or 128-color
  // Let's create a tailored palette for our dark theme with blues, purples, cyans, whites
  palette.push([11, 15, 25]);   // 0: bg dark
  palette.push([17, 24, 39]);   // 1: bg card
  palette.push([30, 41, 59]);   // 2: border/card light
  palette.push([56, 189, 248]); // 3: cyan
  palette.push([129, 140, 248]);// 4: indigo
  palette.push([192, 132, 252]);// 5: purple
  palette.push([52, 211, 153]); // 6: emerald
  palette.push([245, 158, 11]); // 7: amber
  palette.push([248, 250, 252]);// 8: white
  palette.push([148, 163, 184]);// 9: slate gray text
  palette.push([100, 116, 139]);// 10: arrow gray
  palette.push([15, 23, 42]);   // 11: bg darker
  palette.push([30, 58, 138]);  // 12: deep blue
  palette.push([88, 28, 135]);  // 13: deep purple
  palette.push([6, 78, 59]);    // 14: deep green
  palette.push([226, 232, 240]);// 15: light text

  // Pad to 16 colors (4-bit color table) or 256
  while (palette.length < 256) {
    palette.push([0, 0, 0]);
  }

  const fd = fs.openSync(filename, 'w');

  function write(buf) {
    fs.writeSync(fd, buf);
  }

  // Header
  write(Buffer.from('GIF89a'));

  // Logical Screen Descriptor (640x320)
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0b11110111; // GCT flag (1), Color Res (7+1=8), Sort (0), GCT size (7 => 2^(7+1)=256 colors)
  lsd[5] = 0; // bg color index
  lsd[6] = 0; // pixel aspect ratio
  write(lsd);

  // Global Color Table (256 * 3 = 768 bytes)
  const gct = Buffer.alloc(256 * 3);
  for (let i = 0; i < 256; i++) {
    gct[i * 3 + 0] = palette[i][0];
    gct[i * 3 + 1] = palette[i][1];
    gct[i * 3 + 2] = palette[i][2];
  }
  write(gct);

  // Netscape Application Extension for looping
  write(Buffer.from([0x21, 0xFF, 0x0B, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00]));

  // LZW Encoder for each frame
  for (let f = 0; f < frames.length; f++) {
    // Graphic Control Extension
    const gce = Buffer.alloc(8);
    gce[0] = 0x21; // Extension Introducer
    gce[1] = 0xF9; // Graphic Control Label
    gce[2] = 0x04; // Block Size
    gce[3] = 0x00; // Disposal method: none, no transparency
    gce.writeUInt16LE(delay, 4); // Delay time (in 1/100s)
    gce[6] = 0; // Transparent color index
    gce[7] = 0x00; // Block Terminator
    write(gce);

    // Image Descriptor
    const id = Buffer.alloc(10);
    id[0] = 0x2C; // Image Separator
    id.writeUInt16LE(0, 1); // Left
    id.writeUInt16LE(0, 3); // Top
    id.writeUInt16LE(width, 5); // Width
    id.writeUInt16LE(height, 7); // Height
    id[9] = 0x00; // No Local Color Table, non-interlaced
    write(id);

    // LZW Compression
    const minCodeSize = 8;
    write(Buffer.from([minCodeSize]));

    const clearCode = 1 << minCodeSize; // 256
    const endCode = clearCode + 1;       // 257

    let curCodeSize = minCodeSize + 1;
    let nextCode = endCode + 1;

    let dict = new Map();
    function resetDict() {
      dict.clear();
      curCodeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }

    let bitBuffer = 0;
    let bitCount = 0;
    let packet = [];
    const subBlocks = [];

    function emitBits(val, count) {
      bitBuffer |= (val << bitCount);
      bitCount += count;
      while (bitCount >= 8) {
        packet.push(bitBuffer & 0xFF);
        bitBuffer >>= 8;
        bitCount -= 8;
        if (packet.length === 254) {
          subBlocks.push(Buffer.from([packet.length, ...packet]));
          packet = [];
        }
      }
    }

    function flushBits() {
      if (bitCount > 0) {
        packet.push(bitBuffer & 0xFF);
        bitBuffer = 0;
        bitCount = 0;
      }
      if (packet.length > 0) {
        subBlocks.push(Buffer.from([packet.length, ...packet]));
        packet = [];
      }
    }

    emitBits(clearCode, curCodeSize);

    const pixels = frames[f];
    let w = '' + pixels[0];

    for (let i = 1; i < pixels.length; i++) {
      const k = '' + pixels[i];
      const wk = w + ',' + k;
      if (dict.has(wk)) {
        w = wk;
      } else {
        const code = w.indexOf(',') === -1 ? parseInt(w, 10) : dict.get(w);
        emitBits(code, curCodeSize);

        if (nextCode < 4096) {
          dict.set(wk, nextCode++);
          if (nextCode === (1 << curCodeSize) && curCodeSize < 12) {
            curCodeSize++;
          }
        } else {
          emitBits(clearCode, curCodeSize);
          resetDict();
        }
        w = k;
      }
    }
    const finalCode = w.indexOf(',') === -1 ? parseInt(w, 10) : dict.get(w);
    emitBits(finalCode, curCodeSize);
    emitBits(endCode, curCodeSize);
    flushBits();

    for (const b of subBlocks) {
      write(b);
    }
    write(Buffer.from([0x00])); // Block Terminator
  }

  // GIF Trailer
  write(Buffer.from([0x3B]));
  fs.closeSync(fd);
}

// Bitmap drawing helper
const W = 640;
const H = 320;

// Basic 5x7 bitmap font for text rendering
const FONT = {
  ' ': [0,0,0,0,0],
  'A': [0x7E, 0x11, 0x11, 0x11, 0x7E],
  'B': [0x7F, 0x49, 0x49, 0x49, 0x36],
  'C': [0x3E, 0x41, 0x41, 0x41, 0x22],
  'D': [0x7F, 0x41, 0x41, 0x22, 0x1C],
  'E': [0x7F, 0x49, 0x49, 0x49, 0x41],
  'F': [0x7F, 0x09, 0x09, 0x09, 0x01],
  'G': [0x3E, 0x41, 0x49, 0x49, 0x7A],
  'H': [0x7F, 0x08, 0x08, 0x08, 0x7F],
  'I': [0x00, 0x41, 0x7F, 0x41, 0x00],
  'J': [0x20, 0x40, 0x41, 0x3F, 0x01],
  'K': [0x7F, 0x08, 0x14, 0x22, 0x41],
  'L': [0x7F, 0x40, 0x40, 0x40, 0x40],
  'M': [0x7F, 0x02, 0x0C, 0x02, 0x7F],
  'N': [0x7F, 0x04, 0x08, 0x10, 0x7F],
  'O': [0x3E, 0x41, 0x41, 0x41, 0x3E],
  'P': [0x7F, 0x09, 0x09, 0x09, 0x06],
  'Q': [0x3E, 0x41, 0x51, 0x21, 0x5E],
  'R': [0x7F, 0x09, 0x19, 0x29, 0x46],
  'S': [0x46, 0x49, 0x49, 0x49, 0x31],
  'T': [0x01, 0x01, 0x7F, 0x01, 0x01],
  'U': [0x3F, 0x40, 0x40, 0x40, 0x3F],
  'V': [0x1F, 0x20, 0x40, 0x20, 0x1F],
  'W': [0x7F, 0x20, 0x18, 0x20, 0x7F],
  'X': [0x63, 0x14, 0x08, 0x14, 0x63],
  'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
  'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
  '0': [0x3E, 0x51, 0x49, 0x45, 0x3E],
  '1': [0x00, 0x42, 0x7F, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4B, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7F, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3C, 0x4A, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1E],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  '•': [0x00, 0x1C, 0x1C, 0x1C, 0x00],
  '>': [0x41, 0x22, 0x14, 0x08, 0x00],
  '|': [0x00, 0x00, 0x7F, 0x00, 0x00]
};

function drawChar(buf, char, startX, startY, scale, color) {
  const glyph = FONT[char.toUpperCase()] || FONT[' '];
  for (let c = 0; c < 5; c++) {
    const col = glyph[c];
    for (let r = 0; r < 7; r++) {
      if ((col >> r) & 1) {
        for (let sx = 0; sx < scale; sx++) {
          for (let sy = 0; sy < scale; sy++) {
            const px = startX + c * scale + sx;
            const py = startY + r * scale + sy;
            if (px >= 0 && px < W && py >= 0 && py < H) {
              buf[py * W + px] = color;
            }
          }
        }
      }
    }
  }
}

function drawString(buf, str, startX, startY, scale, color, letterSpacing = 1) {
  let cx = startX;
  for (let i = 0; i < str.length; i++) {
    drawChar(buf, str[i], cx, startY, scale, color);
    cx += (5 + letterSpacing) * scale;
  }
}

function fillRect(buf, rx, ry, rw, rh, color) {
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (x >= 0 && x < W && y >= 0 && y < H) {
        buf[y * W + x] = color;
      }
    }
  }
}

function strokeRect(buf, rx, ry, rw, rh, color) {
  for (let x = rx; x < rx + rw; x++) {
    if (x >= 0 && x < W) {
      if (ry >= 0 && ry < H) buf[ry * W + x] = color;
      if (ry + rh - 1 >= 0 && ry + rh - 1 < H) buf[(ry + rh - 1) * W + x] = color;
    }
  }
  for (let y = ry; y < ry + rh; y++) {
    if (y >= 0 && y < H) {
      if (rx >= 0 && rx < W) buf[y * W + rx] = color;
      if (rx + rw - 1 >= 0 && rx + rw - 1 < W) buf[y * W + (rx + rw - 1)] = color;
    }
  }
}

// Generate 8 animated frames
const totalFrames = 8;
const frames = [];

for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
  const buf = new Uint8Array(W * H);
  buf.fill(0); // dark background

  // Notice requirement:
  // "This Social Preview picture must be made with 50px padding on both top and bottom each to prevent being cropped."
  // So all content is constrained between y = 50 and y = 270 (height 220px)!

  // Card background inside padding
  fillRect(buf, 20, 50, W - 40, 220, 1);
  strokeRect(buf, 20, 50, W - 40, 220, 2);

  // Animated gradient highlight line on top border
  const cycleColor = [3, 4, 5, 6, 7][frameIdx % 5];
  strokeRect(buf, 21, 51, W - 42, 1, cycleColor);

  // Tag Badge: "RETAIL ASSORTMENT PLANNING"
  fillRect(buf, 35, 60, 220, 18, 2);
  strokeRect(buf, 35, 60, 220, 18, cycleColor);
  drawString(buf, "ENTERPRISE & OPEN SOURCE", 45, 65, 1, 3);

  // Big Main Title (scale 3)
  // "RETAIL ASSORTMENT"
  drawString(buf, "RETAIL ASSORTMENT", 35, 88, 3, 8, 1);
  // "PLANNING MATRIX"
  drawString(buf, "PLANNING MATRIX", 35, 115, 3, cycleColor, 1);

  // Subtitle (scale 1)
  drawString(buf, "COMMERCIAL SAAS BENCHMARKS & OPEN-SOURCE ARCHITECTURES", 35, 148, 1, 9, 1);
  drawString(buf, "DEMAND FORECASTING - CHOICE MODELS - INVENTORY OPTIMIZATION", 35, 160, 1, 9, 1);

  // 4 Pipeline Cards at bottom (within y = 180 to 255)
  const steps = [
    { title: "FORECAST", col: 3 },
    { title: "CHOICE", col: 4 },
    { title: "OPTIMIZE", col: 5 },
    { title: "ALLOCATE", col: 6 }
  ];

  const cardW = 125;
  const cardH = 45;
  const startX = 35;
  const gap = 20;

  for (let s = 0; s < steps.length; s++) {
    const x = startX + s * (cardW + gap);
    const y = 185;
    const isLit = (frameIdx % 4) === s;

    fillRect(buf, x, y, cardW, cardH, isLit ? 2 : 11);
    strokeRect(buf, x, y, cardW, cardH, isLit ? steps[s].col : 2);
    drawString(buf, steps[s].title, x + 20, y + 18, 1, isLit ? 8 : steps[s].col, 1);

    if (s < steps.length - 1) {
      drawString(buf, ">", x + cardW + 6, y + 18, 1, isLit ? 3 : 10);
    }
  }

  frames.push(buf);
}

writeGIF('assets/social-preview.gif', W, H, frames, 25);
console.log('GIF generated successfully. Size:', fs.statSync('assets/social-preview.gif').size, 'bytes');
