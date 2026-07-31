require('dotenv').config();

module.exports = {
  botToken: process.env.BOT_TOKEN,
  nodeEnv: process.env.NODE_ENV || 'development',
  gridCols: parseInt(process.env.GRID_COLS, 10) || 4,
  gridRows: parseInt(process.env.GRID_ROWS, 10) || 4,
  // اختياري: مفتاح Groq (مجاني) لتفعيل اكتشاف صندوق الكود بالذكاء الاصطناعي
  // لو سبته فاضي، البوت هيستخدم طريقة الشبكة الاحتياطية تلقائياً
  groqApiKey: process.env.GROQ_API_KEY || null,
};
