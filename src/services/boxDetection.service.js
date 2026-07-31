const sharp = require('sharp');

const ANALYSIS_MAX_DIM = 700; // تصغير الصورة للتحليل السريع مع الاحتفاظ بدقة كافية لحواف الصندوق
const MAX_RANGE = 26; // أقصى مدى سطوع (max-min) مسموح بيه جوه نفس المنطقة المتصلة
const MIN_AREA_RATIO = 0.006;
const MAX_AREA_RATIO = 0.3; // رفض أي منطقة كبرت أوي (على الأغلب خلفية مش صندوق حقيقي)
const MIN_FILL_RATIO = 0.82; // الصندوق الحقيقي بيملأ صندوقه المحيط (bounding box) شبه بالكامل
const EDGE_CONTRAST_SAMPLE = 6; // سُمك الشريط المحيط بالصندوق اللي بنقيس بيه "حدة" حافته
const LABEL_DARK_DELTA = 55; // أي بكسل أغمق من متوسط الصندوق بالقد ده يعتبر جزء من نص تسمية (زي "PROMO:")

/**
 * كاشف صندوق محلي بالكامل (بدون شبكة/AI):
 * بيعمل "flood fill" على الصورة كلها (تلوين مناطق متصلة) بحيث أي بكسلين جيران بينضموا
 * لنفس المنطقة طول ما مدى السطوع الكلي جوه المنطقة (max-min) لسه أقل من حد معين -
 * ده بيمنع "تسرب" المنطقة عبر تدرجات لونية ناعمة (زي خلفية سماء متدرجة) لأن مداها
 * بيكبر تدريجياً لحد ما يتجاوز الحد المسموح، بعكس صندوق حقيقي (زي كرت أبيض) اللي
 * لونه شبه ثابت من كل حتة فيه فيفضل جوه الحد المسموح للنهاية.
 *
 * بعد كده بيقيّم كل منطقة متصلة اتلقت: هل شكلها "مستطيل" فعلاً (fill ratio عالي)،
 * حجمها منطقي، وحافتها واضحة (فرق سطوع كبير عن اللي حواليها) - عشان يميّز صندوق UI
 * حقيقي عن مجرد بقعة خلفية مسطحة.
 *
 * بيرجع { x, y, width, height } لو لقى صندوق منطقي، أو null لو مفيش صندوق واضح
 * (يخلي الكود يرجع للطريقة الاحتياطية الأخيرة: تحليل الشبكة العام).
 */
async function findLocalBoxPlacement(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  if (!width || !height) return null;

  const scale = ANALYSIS_MAX_DIM / Math.max(width, height);
  const aw = Math.max(1, Math.round(width * scale));
  const ah = Math.max(1, Math.round(height * scale));

  const { data, info } = await image
    .clone()
    .resize(aw, ah)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rw = info.width;
  const rh = info.height;
  const totalPixels = rw * rh;

  const labels = new Int32Array(totalPixels).fill(-1);
  const components = [];

  // === Flood fill بمدى سطوع محدود: تقسيم الصورة كلها لمناطق متصلة "شبه موحدة اللون" ===
  const queueX = new Int32Array(totalPixels);
  const queueY = new Int32Array(totalPixels);

  for (let sy = 0; sy < rh; sy++) {
    for (let sx = 0; sx < rw; sx++) {
      const startIdx = sy * rw + sx;
      if (labels[startIdx] !== -1) continue;

      const label = components.length;
      let head = 0;
      let tail = 0;
      queueX[tail] = sx;
      queueY[tail] = sy;
      tail++;
      labels[startIdx] = label;

      let minVal = data[startIdx];
      let maxVal = data[startIdx];
      let sum = 0;
      let count = 0;
      let minX = sx;
      let maxX = sx;
      let minY = sy;
      let maxY = sy;

      while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = y * rw + x;
        const v = data[idx];
        sum += v;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        const neighbors = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
          const nIdx = ny * rw + nx;
          if (labels[nIdx] !== -1) continue;

          const nv = data[nIdx];
          const candidateMin = Math.min(minVal, nv);
          const candidateMax = Math.max(maxVal, nv);
          if (candidateMax - candidateMin > MAX_RANGE) continue;

          minVal = candidateMin;
          maxVal = candidateMax;
          labels[nIdx] = label;
          queueX[tail] = nx;
          queueY[tail] = ny;
          tail++;
        }
      }

      components.push({ count, minX, maxX, minY, maxY, mean: sum / count });
    }
  }

  // === تقييم كل منطقة متصلة: هل هي صندوق UI حقيقي؟ ===
  const rectMeanFast = (x0, y0, x1, y1) => {
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(rw, x1);
    y1 = Math.min(rh, y1);
    if (x1 <= x0 || y1 <= y0) return null;
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += data[y * rw + x];
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  };

  const candidates = [];

  for (const comp of components) {
    const boxW = comp.maxX - comp.minX + 1;
    const boxH = comp.maxY - comp.minY + 1;
    const bboxArea = boxW * boxH;
    const areaRatio = bboxArea / totalPixels;

    if (areaRatio < MIN_AREA_RATIO || areaRatio > MAX_AREA_RATIO) continue;

    const fillRatio = comp.count / bboxArea;
    if (fillRatio < MIN_FILL_RATIO) continue;

    const touchesAllEdges = comp.minX <= 0 && comp.maxX >= rw - 1 && comp.minY <= 0 && comp.maxY >= rh - 1;
    if (touchesAllEdges) continue;

    // قياس "حدة" حافة الصندوق: فرق السطوع بين جوه المنطقة وبره حدودها مباشرة
    const topMean = rectMeanFast(comp.minX, comp.minY - EDGE_CONTRAST_SAMPLE, comp.maxX + 1, comp.minY);
    const bottomMean = rectMeanFast(comp.minX, comp.maxY + 1, comp.maxX + 1, comp.maxY + 1 + EDGE_CONTRAST_SAMPLE);
    const leftMean = rectMeanFast(comp.minX - EDGE_CONTRAST_SAMPLE, comp.minY, comp.minX, comp.maxY + 1);
    const rightMean = rectMeanFast(comp.maxX + 1, comp.minY, comp.maxX + 1 + EDGE_CONTRAST_SAMPLE, comp.maxY + 1);

    const ringMeans = [topMean, bottomMean, leftMean, rightMean].filter((v) => v !== null);
    const outsideMean =
      ringMeans.length > 0 ? ringMeans.reduce((a, b) => a + b, 0) / ringMeans.length : comp.mean;
    const edgeContrast = Math.abs(comp.mean - outsideMean);

    // النتيجة: نفضّل شكل مستطيل واضح (fillRatio عالي)، حافة حادة، وحجم أكبر
    const score = fillRatio * 140 + edgeContrast * 1.2 + Math.log(bboxArea + 1) * 6;

    candidates.push({
      left: comp.minX,
      top: comp.minY,
      right: comp.maxX + 1,
      bottom: comp.maxY + 1,
      boxW,
      boxH,
      mean: comp.mean,
      score,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // الـ flood fill بيقدر "يلف" حوالين نص تسمية (زي "PROMO:") لو مبيوصلش لحواف الصندوق -
  // من فوقه أو تحته - فالصندوق المكتشف ممكن يشمل التسمية دي غلط. هنا بندور جوه الصندوق
  // على أبعد عمود فيه بكسل غامق (جزء من حرف) ونقص الصندوق عشان يبدأ بعدها - يعني نستخدم
  // بس المساحة الفاضية الفعلية بعد التسمية، مش الصندوق كله
  const darkThreshold = best.mean - LABEL_DARK_DELTA;
  let labelEndX = -1;
  for (let bx = best.left; bx < best.right; bx++) {
    for (let by = best.top; by < best.bottom; by++) {
      if (data[by * rw + bx] < darkThreshold) {
        labelEndX = bx;
        break;
      }
    }
  }

  let effectiveLeft = best.left;
  if (labelEndX >= best.left) {
    const candidateLeft = labelEndX + 1;
    // متسيبش أقل من مساحة معقولة فاضية فعلية بعد التسمية
    if (candidateLeft < best.right - Math.max(20, best.boxW * 0.15)) {
      effectiveLeft = candidateLeft;
    }
  }

  const effectiveBoxW = best.right - effectiveLeft;

  const scaleX = width / rw;
  const scaleY = height / rh;

  // انسحاب بسيط لجوه عشان نتجنب حواف الصندوق (border/ظل/antialiasing)
  const insetX = Math.round(effectiveBoxW * 0.08);
  const insetY = Math.round(best.boxH * 0.12);

  const x = (effectiveLeft + insetX) * scaleX;
  const y = (best.top + insetY) * scaleY;
  const w = (effectiveBoxW - insetX * 2) * scaleX;
  const h = (best.boxH - insetY * 2) * scaleY;

  if (w < 10 || h < 10) return null;

  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

module.exports = { findLocalBoxPlacement };
