const sharp = require('sharp');

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * بيحط نص البروموكود فوق الصورة في المكان اللي حدده imageAnalysis.service
 * بيستخدم SVG (نص + حدود/stroke) عشان يبقى واضح على أي خلفية
 */
async function applyPromoCode(imageBuffer, code, placement) {
  const { x, y, cellWidth, cellHeight, imageWidth, imageHeight, textColor, strokeColor } = placement;

  // حجم الخط بيتحسب حسب عرض المنطقة وطول النص، وبيتقيّد كمان بارتفاع المنطقة
  // (مهم خصوصاً لما المكان جاي من صندوق دقيق حدده الذكاء الاصطناعي)
  const widthBasedSize = Math.round(cellWidth / Math.max(code.length * 0.6, 1));
  const heightBasedSize = cellHeight ? Math.round(cellHeight * 0.6) : widthBasedSize;
  const fontSize = Math.max(14, Math.min(widthBasedSize, heightBasedSize, 72));
  const strokeWidth = Math.max(2, Math.round(fontSize / 12));

  const safeCode = escapeXml(code);

  const svg = `
    <svg width="${imageWidth}" height="${imageHeight}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${x}"
        y="${y}"
        font-family="Arial, Helvetica, sans-serif"
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
