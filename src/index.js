const { createBot } = require('./bot/bot');
const config = require('./config/env');
const logger = require('./utils/logger');

// شبكة أمان أخيرة على مستوى العملية كلها: أي استثناء غير متوقع (خارج نطاق أي try/catch
// موجود، أو من مكتبة خارجية) بيتسجل بس من غير ما يوقف البوت. كل handler أصلاً بيمسك
// أخطاءه الخاصة و bot.catch() بيمسك أخطاء Telegraf، فده آخر خط دفاع نظري بس.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

if (!config.botToken) {
  logger.error('BOT_TOKEN مش موجود. اعمل نسخة من .env.example باسم .env وحط التوكن فيه.');
  process.exit(1);
}

if (config.groqApiKey) {
  logger.info('الذكاء الاصطناعي (Groq Vision) مفعّل ✅ - هيدور على صندوق الكود بدقة عالية');
} else {
  logger.warn(
    'GROQ_API_KEY مش موجود في .env - البوت هيشتغل بطريقة الشبكة الاحتياطية بس (أقل دقة مع القوالب الجاهزة زي 1xBet)'
  );
}

const bot = createBot();

bot
  .launch()
  .then(() => logger.info('البوت شغال دلوقتي ✅'))
  .catch((err) => {
    logger.error('فشل تشغيل البوت:', err);
    process.exit(1);
  });

// إيقاف نظيف للبوت (مهم على Railway وعند إعادة التشغيل)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
