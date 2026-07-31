const fetch = require('node-fetch');
const { setSession } = require('../../services/session.service');
const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.on('photo', async (ctx) => {
    try {
      const photos = ctx.message.photo;
      const largestPhoto = photos[photos.length - 1]; // أعلى دقة متاحة

      const fileLink = await ctx.telegram.getFileLink(largestPhoto.file_id);
      const response = await fetch(fileLink.href);

      if (!response.ok) {
        throw new Error(`فشل تحميل الصورة: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      setSession(ctx.chat.id, { step: 'awaiting_code', imageBuffer });

      await ctx.reply('تمام، وصلتني الصورة ✅\nدلوقتي ابعتلي البروموكود اللي عايز تحطه.');
    } catch (err) {
      logger.error('photo.handler error:', err);
      await ctx.reply('حصل خطأ أثناء استقبال الصورة، جرب تاني.');
    }
  });
};
