const sharp = require('sharp');
const opentype = require('opentype.js');
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.join(__dirname, '..', '..', 'fonts', 'Roboto-Bold.ttf');

let cachedFont = null;

function getFont() {
  if (!cachedFont) {
    const buf = fs.readFileSync(FONT_PATH);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    cachedFont = opentype.parse(arrayBuffer);
  }
  return cachedFont;
}

async function applyPromoCode(imageBuffer, code, placement) {
  const { x, y, cellWidth, cellHeight, imageWidth, imageHeight, textColor, strokeColor } = placement;

  const widthBasedSize = Math.round(cellWidth / Math.max(code.length * 0.6, 1));
  const heightBasedSize = cellHeight ? Math.round(cellHeight * 0.6) : widthBasedSize;
  const fontSize = Math.max(14, Math.min(widthBasedSize, heightBasedSize, 72));
  const strokeWidth = Math.max(2, Math.round(fontSize / 12));

  const font = getFont();
  const scale = fontSize / font.unitsPerEm;

  const advanceWidth = font.getAdvanceWidth(code, fontSize);
  const startX = x - advanceWidth / 2;
  const baselineY = y + ((font.ascender + font.descender) * scale) / 2;

  const textPath = font.getPath(code, startX, baselineY, fontSize);
  const pathData = textPath.toPathData(2);

  const svg = `
    <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      <path
        d="${pathData}"
        fill="${textColor}"
        stroke="${strokeColor}"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
        paint-order="stroke"
      />
    </svg>
  `;

  const svgBuffer = Buffer.from(svg);

  return sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .toBuffer();
}

module.exports = { applyPromoCode };
