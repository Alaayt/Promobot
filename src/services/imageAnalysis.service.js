const sharp = require('sharp');
const config = require('../config/env');

const ANALYSIS_WIDTH = 200; // تصغير الصورة للتحليل السريع فقط (مش هيأثر على جودة النتيجة النهائية)

/**
 * بيحلل الصورة ويلاقي أفضل مكان لوضع البروموكود:
 * - بيقسم الصورة لشبكة (grid)
 * - بيحسب "التباين" (variance) في كل خلية (الخلية اللي تباينها قليل = منطقة مسطحة/فاضية = مكان كويس للنص)
 * - بيرجع إحداثيات المنطقة المختارة + لون النص المناسب (أبيض/أسود) حسب سطوع الخلفية
 */
async function findGridPlacement(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error('تعذر قراءة أبعاد الصورة');
  }

  const analysisHeight = Math.max(1, Math.round((ANALYSIS_WIDTH / width) * height));

  const { data, info } = await image
    .clone()
    .resize(ANALYSIS_WIDTH, analysisHeight)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gridCols = config.gridCols;
  const gridRows = config.gridRows;
  const cellWidth = Math.max(1, Math.floor(info.width / gridCols));
  const cellHeight = Math.max(1, Math.floor(info.height / gridRows));

  let bestCell = null;
  let bestScore = Infinity;

  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const startX = col * cellWidth;
      const startY = row * cellHeight;
      const endX = Math.min(startX + cellWidth, info.width);
      const endY = Math.min(startY + cellHeight, info.height);

      let sum = 0;
      let count = 0;
      const values = [];

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * info.width + x;
          const v = data[idx];
          values.push(v);
          sum += v;
          count++;
        }
      }

      if (count === 0) continue;

      const mean = sum / count;
      const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;

      // تفضيل بسيط للصفوف السفلية (مكان شائع للبروموكود)، بدون ما يمنع اختيار مناطق تانية لو أفضل بكتير
      const positionBonus = row >= gridRows - 2 ? -30 : 0;
      const score = variance + positionBonus;

      if (score < bestScore) {
        bestScore = score;
        bestCell = { row, col, mean };
      }
    }
  }

  if (!bestCell) {
    // fallback: منتصف الصورة لو لأي سبب التحليل فشل
    bestCell = { row: Math.floor(gridRows / 2), col: Math.floor(gridCols / 2), mean: 128 };
  }

  const scaleX = width / info.width;
  const scaleY = height / info.height;

  const cellX = bestCell.col * cellWidth * scaleX;
  const cellY = bestCell.row * cellHeight * scaleY;
  const cellW = cellWidth * scaleX;
  const cellH = cellHeight * scaleY;

  const isDarkBackground = bestCell.mean < 128;

  return {
    imageWidth: width,
    imageHeight: height,
    x: Math.round(cellX + cellW / 2),
    y: Math.round(cellY + cellH / 2),
    cellWidth: Math.round(cellW),
    cellHeight: Math.round(cellH),
    textColor: isDarkBackground ? '#FFFFFF' : '#000000',
    strokeColor: isDarkBackground ? '#000000' : '#FFFFFF',
  };
}

/**
 * بيحسب متوسط سطوع منطقة معينة في الصورة (مفيد لتحديد لون النص المناسب فوق صندوق حدده الذكاء الاصطناعي)
 */
async function getRegionBrightness(imageBuffer, region) {
  try {
    const left = Math.max(0, Math.round(region.x));
    const top = Math.max(0, Math.round(region.y));
    const width = Math.max(1, Math.round(region.width));
    const height = Math.max(1, Math.round(region.height));

    const stats = await sharp(imageBuffer)
      .extract({ left, top, width, height })
      .grayscale()
      .stats();

    return stats.channels[0].mean;
  } catch (err) {
    return 128; // قيمة متوسطة افتراضية لو الاستخراج فشل (مثلاً حدود خارج الصورة)
  }
}

module.exports = { findGridPlacement, getRegionBrightness };
