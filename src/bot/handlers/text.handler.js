const { getSession, clearSession } = require('../../services/session.service');
const { generatePromoImage } = require('../../controllers/promo.controller');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.on('text', async (ctx) => {
    // تجاهل الأوامر (اللي بتبدأ بـ /) عشان ما تتعاملش كأنها كود
    if (ctx.message.text.startsWith('/')) return;

    const session = getSession(ctx.chat.id);

    if (!session || session.step !== 'awaiting_code' || !session.imageBuffer) {
      await ctx.reply('ابعتلي صورة الأول 📷، وبعدها اكتب البروموكود.');
      return;
    }

    const code = ctx.message.text.trim();

    try {
      const processingMsg = await ctx.reply('جاري التحليل والتجهيز... ⏳');

      const resultBuffer = await generatePromoImage(session.imageBuffer, code);

      await ctx.replyWithPhoto({ source: resultBuffer });

      await ctx.deleteMessage(processingMsg.message_id).catch(() => {});

      clearSession(ctx.chat.id);
    } catch (err) {
      logger.error('text.handler error:', err);
      await ctx.reply('حصل خطأ أثناء المعالجة، جرب تاني بصورة تانية أو كود تاني.');
      clearSession(ctx.chat.id);
    }
  });
};
