// Writes a one-frame Y4M video of an EAN-13 barcode. Chrome plays it as a fake camera
// (--use-file-for-fake-video-capture), so the end-to-end test can scan like a phone would.
import { writeFileSync } from 'node:fs';

const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const L = R.map((code) => code.replace(/./g, (bit) => (bit === '1' ? '0' : '1')));
const G = R.map((code) => [...code].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The 95 black (1) / white (0) modules of an EAN-13 barcode. */
export function ean13Modules(code) {
  const digits = [...code].map(Number);
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (PARITY[digits[0]][i - 1] === 'L' ? L : G)[digits[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[digits[i]];
  return `${bits}101`;
}

export function writeBarcodeVideo(path, code, { width = 640, height = 480, module = 4 } = {}) {
  const bits = ean13Modules(code);
  const luma = Buffer.alloc(width * height, 235); // white
  const left = Math.floor((width - bits.length * module) / 2);
  for (let row = Math.floor(height * 0.25); row < Math.floor(height * 0.75); row++) {
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === '1') luma.fill(16, row * width + left + i * module, row * width + left + (i + 1) * module);
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128); // no colour
  const header = `YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420jpeg\nFRAME\n`;
  writeFileSync(path, Buffer.concat([Buffer.from(header), luma, chroma]));
}
