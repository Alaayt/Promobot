const sharp = require('sharp');
const { findPromoBoxWithAI } = require('../services/aiVision.service');
const { refineBox } = require('../services/boxRefinement.service');
const { findGridPlacement, getRegionBrightness } = require('../services/imageAnalysis.service');
const { applyPromoCode } = require('../services/imageEditor.service');
const logger = require('../utils/logger');

/**
 * بيحول صندوق (من الذكاء الاصطناعي) لشكل الـ placement اللي محتاجه imageEditor
 * بيحدد لون النص تلقائياً حسب سطوع المنطقة الفعلية جوه الصندوق
 */
async function boxToPlacement(imageBuffer, box, imageWidth, imageHeight) {
  const brightness = await getRegionBrightness(imageBuffer, box);
  const isDarkBackground = brightness < 128;

  return {
    imageWidth,
    imageHeight,
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
    cellWidth: Math.round(box.width),
    cellHeight: Math.round(box.height),
    textColor: isDarkBackground ? '#FFFFFF' : '#000000',
    strokeColor: isDarkBackground ? '#000000' : '#FFFFFF',
  };
}

/**
 * بياخد صورة + كود، ويرجع الصورة بعد ما اتحط عليها الكود في أنسب مكان.
 *
 * الأولوية:
 * 1) الذكاء الاصطناعي (Groq Vision) - بيدي تقدير تقريبي لمكان صندوق الكود.
 * 2) تدقيق محلي (Sharp) - بيدور حوالين التقدير التقريبي عشان يلاقي حدود الصندوق الفعلي بدقة.
 * 3) لو الذكاء الاصطناعي مش متاح أو مالقاش صندوق أصلاً - يرجع لطريقة تحليل الشبكة (أنسب منطقة فاضية).
 */
async function generatePromoImage(imageBuffer, code) {
  if (!code || !code.trim()) {
    throw new Error('البروموكود فارغ');
  }

  const metadata = await sharp(imageBuffer).metadata();
  const { width, height } = metadata;

  let placement;

  const aiBox = await findPromoBoxWithAI(imageBuffer, width, height);

  if (aiBox) {
    const refined = await refineBox(imageBuffer, aiBox, width, height);
    const finalBox = refined || aiBox;

    logger.info(
      refined
        ? 'تم تدقيق مكان الصندوق محلياً بعد تقدير الذكاء الاصطناعي (دقة عالية)'
        : 'فشل التدقيق المحلي، تم استخدام تقدير الذكاء الاصطناعي التقريبي كما هو'
    );

    placement = await boxToPlacement(imageBuffer, finalBox, width, height);
  } else {
    logger.info('تم استخدام تحليل الشبكة الاحتياطي (أنسب منطقة فاضية)');
    placement = await findGridPlacement(imageBuffer);
  }

  const resultBuffer = await applyPromoCode(imageBuffer, code.trim(), placement);

  return resultBuffer;
}

module.exports = { generatePromoImage };
