const Groq = require('groq-sdk');
const config = require('../config/env');
const logger = require('../utils/logger');

// قائمة موديلات الرؤية اللي هيتجرب عليها بالترتيب - لو الأول فشل (بعد إعادة المحاولة التلقائية)
// بيتجرب اللي بعده، وهكذا. ده بيحمي من تعطل/تقاعد موديل معيّن في Groq من غير ما يوقف الميزة كلها.
// ملحوظة: قائمة موديلات Groq بتتغير بين فترة وفترة. تقدر تضيف موديلات احتياطية تانية عن طريق
// متغير البيئة VISION_MODELS (أسماء موديلات مفصولة بفاصلة)، أو سيبه فاضي عشان يستخدم القيمة الافتراضية دي.
// راجع https://console.groq.com/docs/vision لأحدث الموديلات المتاحة.
const DEFAULT_VISION_MODELS = ['qwen/qwen3.6-27b'];
const VISION_MODELS = config.visionModels.length > 0 ? config.visionModels : DEFAULT_VISION_MODELS;

const REQUEST_TIMEOUT_MS = 15000; // متنستناش موديل واحد أكتر من كده قبل ما نجرب اللي بعده أو نرجع للطريقة الاحتياطية
const MAX_RETRIES_PER_MODEL = 2; // إعادة محاولة تلقائية (من مكتبة Groq نفسها) لو حصل خطأ شبكة/5xx مؤقت

let client = null;
if (config.groqApiKey) {
  client = new Groq({ apiKey: config.groqApiKey });
}

function buildPrompt(imageWidth, imageHeight) {
  return (
    `هذه صورة إعلانية أبعادها بالبكسل: العرض ${imageWidth} والارتفاع ${imageHeight}. ` +
    'ابحث عن صندوق أو حقل فارغ مخصص لكتابة كود ترويجي/خصم (Promo Code / Coupon Code)، ' +
    'زي حقل له حدود (border) فيه مكان فاضي، أو يوجد بجانبه نص مثل "كود" أو "Code" أو "استخدم الكود الترويجي". ' +
    'لو لقيت صندوق واضح زي ده، رد بصيغة JSON فقط بالشكل ده بالظبط: ' +
    '{"found": true, "x": رقم, "y": رقم, "width": رقم, "height": رقم} ' +
    'حيث x,y هي إحداثيات الزاوية العلوية اليسرى للصندوق بالبكسل الفعلي حسب أبعاد الصورة المذكورة أعلاه. ' +
    'لو مفيش صندوق واضح مخصص للكود (يعني الصورة عادية زي منظر طبيعي أو صورة شخصية)، رد بـ {"found": false}. ' +
    'رد بـ JSON فقط، من غير أي شرح أو نص إضافي.'
  );
}

// بيرجع { found: false } كإجابة نهائية موثوقة (الموديل شغال ورد إنه مفيش صندوق)،
// أو بيرمي استثناء لو الرد فاضي/مش JSON صحيح/إحداثيات مش منطقية - عشان الحالات دي
// تتعامل كـ"فشل" يستأهل تجربة موديل احتياطي تاني، مش كإجابة نهائية
function parseModelResponse(response, imageWidth, imageHeight) {
  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error('رد فاضي من الموديل');

  const parsed = JSON.parse(raw);
  if (parsed.found === false) return { found: false };

  const { x, y, width, height } = parsed;

  const isValid =
    [x, y, width, height].every((v) => typeof v === 'number' && !Number.isNaN(v)) &&
    width > 0 &&
    height > 0 &&
    x >= 0 &&
    y >= 0 &&
    x + width <= imageWidth * 1.05 &&
    y + height <= imageHeight * 1.05;

  if (!isValid) throw new Error('إحداثيات غير منطقية من الموديل');

  return { found: true, x, y, width, height };
}

async function callVisionModel(model, base64Image, imageWidth, imageHeight) {
  const response = await client.chat.completions.create(
    {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(imageWidth, imageHeight) },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    },
    { timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES_PER_MODEL }
  );

  return parseModelResponse(response, imageWidth, imageHeight);
}

/**
 * بيستخدم موديل رؤية (Vision) عشان يلاقي صندوق/حقل الكود الترويجي بدقة (لو موجود في الصورة).
 * بيجرب كل موديل في VISION_MODELS بالترتيب لحد ما واحد فيهم يرد بنجاح؛ لو موديل معيّن فشل
 * (تايم آوت، خطأ شبكة، رد غير منطقي) بعد إعادة المحاولة التلقائية، بيتجرب اللي بعده تلقائياً.
 *
 * بيرجع:
 *  - { x, y, width, height } لو لقى صندوق واضح ومنطقي
 *  - null لو مفيش صندوق فعلاً في الصورة (رد موديل شغال بـ found:false)، أو المفتاح مش متوفر،
 *    أو كل الموديلات فشلت (يخلي الكود يستخدم الطريقة الاحتياطية: الكاشف المحلي ثم الشبكة)
 */
async function findPromoBoxWithAI(imageBuffer, imageWidth, imageHeight) {
  if (!client) return null;

  const base64Image = imageBuffer.toString('base64');

  for (let i = 0; i < VISION_MODELS.length; i++) {
    const model = VISION_MODELS[i];
    try {
      const result = await callVisionModel(model, base64Image, imageWidth, imageHeight);
      if (!result.found) return null; // إجابة نهائية موثوقة: الموديل شغال ومفيش صندوق فعلاً
      return { x: result.x, y: result.y, width: result.width, height: result.height };
    } catch (err) {
      const isLastModel = i === VISION_MODELS.length - 1;
      logger.warn(
        `فشل استدعاء موديل الرؤية (${model})، ` +
          (isLastModel ? 'هيتم استخدام الطريقة الاحتياطية المحلية' : 'هيتم تجربة موديل احتياطي تاني') +
          `: ${err.message}`
      );
    }
  }

  return null;
}

module.exports = { findPromoBoxWithAI };
