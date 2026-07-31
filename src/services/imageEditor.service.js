const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const FONT_PATH = path.join(__dirname, '..', '..', 'fonts', 'Roboto-Bold.ttf');
const FONT_FAMILY = 'PromoFont';

let cachedFontBase64 = null;

function getFontBase64() {
  if (!cachedFontBase64) {
    cachedFontBase64 = fs.readFileSync(FONT_PATH).toString('base64');
  }
  return cachedFontBase64;
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function applyPromoCode(imageBuffer, code, placement) {
  const { x, y, cellWidth, cellHeight, imageWidth, imageHeight, textColor, strokeColor } = placement;

  const widthBasedSize = Math.round(cellWidth / Math.max(code.length * 0.6, 1));
  const heightBasedSize = cellHeight ? Math.round(cellHeight * 0.6) : widthBasedSize;
  const fontSize = Math.max(14, Math.min(widthBasedSize, heightBasedSize, 72));
  const strokeWidth = Math.max(2, Math.round(fontSize / 12));

  const safeCode = escapeXml(code);
  const fontBase64 = getFontBase64();

  const svg = `
    <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style type="text/css">
          @font-face {
            font-family: '${FONT_FAMILY}';
            src: url(data:font/truetype;charset=utf-8;base64,${fontBase64}) format('truetype');
            font-weight: bold;
          }
        </style>
      </defs>
      <text
        x="${x}"
        y="${y}"
        font-family="${FONT_FAMILY}"
        font-size="${fontSize}"
        font-weight="bold"
        fill="${textColor}"
        stroke="${strokeColor}"
        stroke-width="${strokeWidth}"
        text-anchor="middle"
        dominant-baseline="middle"
        paint-order="stroke"
      >${safeCode}</text>
    </svg>
  `;

  const svgBuffer = Buffer.from(svg);

  return sharp(imageBuffer)
    .composite([{ input: svgBuffer, top: 0, left: 0 }])
    .toBuffer();
}

module.exports = { applyPromoCode };