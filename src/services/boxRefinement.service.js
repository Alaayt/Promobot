const sharp = require('sharp');
const logger = require('../utils/logger');

const MIN_WINDOW = 6; // أصغر حجم نافذة "ارتكاز" مسموح بيها (بكسل)
const MEAN_TOLERANCE = 18; // أقصى فرق سطوع (0-255) عشان نعتبر الشريط المجاور "لسه جوه نفس الصندوق"
const MAX_GROWTH_RATIO = 0.9; // لو الصندوق النهائي غطى أكتر من 90% من منطقة البحث، يبقى غالباً طلعنا بره حدوده الحقيقية

/**
 * بياخد مكان تقريبي (من الذكاء الاصطناعي) وبيدقق عليه محلياً على مرحلتين:
 *
 * 1) "ارتكاز" (anchor): بيدور جوه نص المكان التقريبي على أصغر نافذة "مسطحة" (variance قليل جداً) -
 *    ده بيمسك نقطة إحنا متأكدين إنها جوه الصندوق فعلاً (مش على حوافه اللي ممكن يكون فيها نص/تدرج لوني)
 * 2) "توسيع" (growth): بيوسّع المستطيل من الارتكاز لكل الاتجاهات، صف/عمود واحد في المرة،
 *    طول ما الشريط الجديد لسه قريب في السطوع من الارتكاز - وده بيرسم حدود الصندوق الحقيقية تلقائياً
 *
 * الطريقة دي بتصحح كل من: إزاحة تقدير الـ AI، وخطأ تقدير حجم الصندوق (مش بس مكانه)
 */
async function refineBox(imageBuffer, approxBox, imageWidth, imageHeight) {
  try {
    const padX = Math.round(approxBox.width * 0.6);
    const padY = Math.round(approxBox.height * 1.2);

    const region = {
      x: Math.max(0, Math.round(approxBox.x - padX)),
      y: Math.max(0, Math.round(approxBox.y - padY)),
    };
    region.width = Math.min(imageWidth - region.x, Math.round(approxBox.width + padX * 2));
    region.height = Math.min(imageHeight - region.y, Math.round(approxBox.height + padY * 2));

    if (region.width < MIN_WINDOW || region.height < MIN_WINDOW) return null;

    const { data, info } = await sharp(imageBuffer)
      .extract({ left: region.x, top: region.y, width: region.width, height: region.height })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width: rw, height: rh } = info;
    const stride = rw + 1;

    // صور تكاملية (integral images) عشان نحسب متوسط/تباين أي مستطيل في وقت ثابت O(1)
    const sum = new Float64Array(stride * (rh + 1));
    const sumSq = new Float64Array(stride * (rh + 1));

    for (let y = 0; y < rh; y++) {
      let rowSum = 0;
      let rowSumSq = 0;
      for (let x = 0; x < rw; x++) {
        const v = data[y * rw + x];
        rowSum += v;
        rowSumSq += v * v;
        const idx = (y + 1) * stride + (x + 1);
        sum[idx] = sum[idx - stride] + rowSum;
        sumSq[idx] = sumSq[idx - stride] + rowSumSq;
      }
    }

    // مستطيل [x0,x1) x [y0,y1) -> {mean, variance}
    const rectStats = (x0, y0, x1, y1) => {
      x0 = Math.max(0, x0);
      y0 = Math.max(0, y0);
      x1 = Math.min(rw, x1);
      y1 = Math.min(rh, y1);
      const n = (x1 - x0) * (y1 - y0);
      if (n <= 0) return { mean: 0, variance: Infinity, n: 0 };
      const s = sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
      const sq =
        sumSq[y1 * stride + x1] - sumSq[y0 * stride + x1] - sumSq[y1 * stride + x0] + sumSq[y0 * stride + x0];
      const mean = s / n;
      const variance = Math.max(0, sq / n - mean * mean);
      return { mean, variance, n };
    };

    // === المرحلة 1: لقاء الارتكاز (أنسب نافذة صغيرة مسطحة قريبة من مركز تقدير الـ AI) ===
    const coreW = Math.min(rw, Math.max(MIN_WINDOW, Math.round(approxBox.width * 0.45)));
    const coreH = Math.min(rh, Math.max(MIN_WINDOW, Math.round(approxBox.height * 0.45)));

    const approxCenterX = approxBox.x + approxBox.width / 2 - region.x;
    const approxCenterY = approxBox.y + approxBox.height / 2 - region.y;
    const maxDist = Math.sqrt(rw * rw + rh * rh) || 1;

    const stepX = Math.max(1, Math.round(coreW / 6));
    const stepY = Math.max(1, Math.round(coreH / 6));

    let anchor = null;
    let bestScore = Infinity;

    for (let y0 = 0; y0 <= rh - coreH; y0 += stepY) {
      for (let x0 = 0; x0 <= rw - coreW; x0 += stepX) {
        const { variance } = rectStats(x0, y0, x0 + coreW, y0 + coreH);
        const cx = x0 + coreW / 2;
        const cy = y0 + coreH / 2;
        const dist = Math.sqrt((cx - approxCenterX) ** 2 + (cy - approxCenterY) ** 2) / maxDist;

        // التباين هو الأساس، والقرب من تقدير الـ AI بيكسر التعادل بس
        const score = variance + dist * 8;

        if (score < bestScore) {
          bestScore = score;
          anchor = { x0, y0 };
        }
      }
    }

    if (!anchor) return null;

    const anchorStats = rectStats(anchor.x0, anchor.y0, anchor.x0 + coreW, anchor.y0 + coreH);
    const anchorMean = anchorStats.mean;

    // === المرحلة 2: توسيع المستطيل من الارتكاز لحد ما نوصل لحواف الصندوق الحقيقية ===
    let left = anchor.x0;
    let right = anchor.x0 + coreW;
    let top = anchor.y0;
    let bottom = anchor.y0 + coreH;

    let expanded = true;
    let iterations = 0;
    const maxIterations = rw + rh; // حد أمان عشان الحلقة متفضلش شغالة للأبد

    while (expanded && iterations < maxIterations) {
      expanded = false;
      iterations++;

      if (left > 0) {
        const strip = rectStats(left - 1, top, left, bottom);
        if (Math.abs(strip.mean - anchorMean) <= MEAN_TOLERANCE) {
          left -= 1;
          expanded = true;
        }
      }
      if (right < rw) {
        const strip = rectStats(right, top, right + 1, bottom);
        if (Math.abs(strip.mean - anchorMean) <= MEAN_TOLERANCE) {
          right += 1;
          expanded = true;
        }
      }
      if (top > 0) {
        const strip = rectStats(left, top - 1, right, top);
        if (Math.abs(strip.mean - anchorMean) <= MEAN_TOLERANCE) {
          top -= 1;
          expanded = true;
        }
      }
      if (bottom < rh) {
        const strip = rectStats(left, bottom, right, bottom + 1);
        if (Math.abs(strip.mean - anchorMean) <= MEAN_TOLERANCE) {
          bottom += 1;
          expanded = true;
        }
      }
    }

    const grownWidth = right - left;
    const grownHeight = bottom - top;
    const areaRatio = (grownWidth * grownHeight) / (rw * rh);

    if (areaRatio > MAX_GROWTH_RATIO) {
      // على الأغلب دخلنا في الخلفية بدل ما نفضل جوه الصندوق - نرجع للتقدير الأصلي بدل نتيجة غلط
      return null;
    }

    // انسحاب بسيط لجوه عشان نتجنب حواف الصندوق (border/ظل) ونضمن النص جوه بأمان
    const insetX = Math.round(grownWidth * 0.06);
    const insetY = Math.round(grownHeight * 0.1);

    const finalWidth = grownWidth - insetX * 2;
    const finalHeight = grownHeight - insetY * 2;

    if (finalWidth < 10 || finalHeight < 10) return null;

    return {
      x: region.x + left + insetX,
      y: region.y + top + insetY,
      width: finalWidth,
      height: finalHeight,
    };
  } catch (err) {
    logger.warn('فشل تدقيق الصندوق محلياً، هيتم استخدام تقدير الذكاء الاصطناعي كما هو:', err.message);
    return null;
  }
}

module.exports = { refineBox };
