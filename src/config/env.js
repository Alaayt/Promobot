require('dotenv').config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  nodeEnv: process.env.NODE_ENV || 'development',
  gridCols: parseInt(process.env.GRID_COLS, 10) || 4,
  gridRows: parseInt(process.env.GRID_ROWS, 10) || 4,
  // اختياري: مفتاح Groq (مجاني) لتفعيل اكتشاف صندوق الكود بالذكاء الاصطناعي
  // لو سبته فاضي، البوت هيستخدم طريقة الشبكة الاحتياطية تلقائياً
  groqApiKey: process.env.GROQ_API_KEY || null,
  // اختياري: قائمة موديلات رؤية احتياطية (مفصولة بفاصلة) بترتيب الأولوية، لو موديل فشل يتجرب اللي بعده
  // مثال: VISION_MODELS=qwen/qwen3.6-27b,llama-3.2-90b-vision-preview
  visionModels: (process.env.VISION_MODELS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean),
};
