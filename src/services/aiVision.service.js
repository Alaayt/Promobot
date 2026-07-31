const Groq = require('groq-sdk');
const config = require('../config/env');
const logger = require('../utils/logger');

// موديل Groq اللي بيدعم الصور + JSON mode
// ملحوظة: قائمة موديلات Groq بتتغير بين فترة وفترة، لو الموديل ده اتقاعد
// راجع https://console.groq.com/docs/vision وحدث الاسم هنا
const VISION_MODEL = 'qwen/qwen3.6-27b';

let client = null;
if (config.groqApiKey) {
  client = new Groq({ apiKey: config.groqApiKey });
}

/**
 * بيستخدم موديل رؤية (Vision) عشان يلاقي صندوق/حقل الكود الترويجي بدقة (لو موجود في الصورة)
 * مثال: صورة فيها "استخدم الكود الترويجي" مع مستطيل فاضي جنبها
 *
 * بيرجع:
 *  - { x, y, width, height } لو لقى صندوق واضح ومنطقي
 *  - null لو مفيش صندوق، أو المفتاح مش متوفر، أو حصل أي خطأ (يخلي الكود يستخدم الطريقة الاحتياطية)
 */
async function findPromoBoxWithAI(imageBuffer, imageWidth, imageHeight) {
  if (!client) return null;

  try {
    const base64Image = imageBuffer.toString('base64');

    const response = await client.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `هذه صورة إعلانية أبعادها بالبكسل: العرض ${imageWidth} والارتفاع ${imageHeight}. ` +
                'ابحث عن صندوق أو حقل فارغ مخصص لكتابة كود ترويجي/خصم (Promo Code / Coupon Code)، ' +
                'زي حقل له حدود (border) فيه مكان فاضي، أو يوجد بجانبه نص مثل "كود" أو "Code" أو "استخدم الكود الترويجي". ' +
                'لو لقيت صندوق واضح زي ده، رد بصيغة JSON فقط بالشكل ده بالظبط: ' +
                '{"found": true, "x": رقم, "y": رقم, "width": رقم, "height": رقم} ' +
                'حيث x,y هي إحداثيات الزاوية العلوية اليسرى للصندوق بالبكسل الفعلي حسب أبعاد الصورة المذكورة أعلاه. ' +
                'لو مفيش صندوق واضح مخصص للكود (يعني الصورة عادية زي منظر طبيعي أو صورة شخصية)، رد بـ {"found": false}. ' +
                'رد بـ JSON فقط، من غير أي شرح أو نص إضافي.',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64Image}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    });

    const raw = response.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed.found) return null;

    const { x, y, width, height } = parsed;

    const isValid =
      [x, y, width, height].every((v) => typeof v === 'number' && !Number.isNaN(v)) &&
      width > 0 &&
      height > 0 &&
      x >= 0 &&
      y >= 0 &&
      x + width <= imageWidth * 1.05 &&
      y + height <= imageHeight * 1.05;

    if (!isValid) {
      logger.warn('الذكاء الاصطناعي رجّع إحداثيات غير منطقية، هيتم التراجع للطريقة الاحتياطية');
      return null;
    }

    return { x, y, width, height };
  } catch (err) {
    logger.warn('فشل استدعاء موديل الرؤية، هيتم استخدام الطريقة الاحتياطية:', err.message);
    return null;
  }
}

module.exports = { findPromoBoxWithAI };
