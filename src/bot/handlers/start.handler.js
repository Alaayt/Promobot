const logger = require('../../utils/logger');

module.exports = (bot) => {
  bot.start(async (ctx) => {
    try {
      await ctx.reply(
        'أهلاً بيك! 👋\n\n' +
          '📷 ابعتلي أي صورة\n' +
          '✍️ بعدها اكتب البروموكود اللي عايزه\n' +
          '🤖 هحلل الصورة تلقائياً وأحط الكود في أنسب مكان فاضي فيها\n\n' +
          'جرب دلوقتي، ابعت صورة!'
      );
    } catch (err) {
      logger.error('start.handler error:', err);
    }
  });

  bot.help(async (ctx) => {
    try {
      await ctx.reply('ابعت صورة الأول، وبعدين اكتب البروموكود. البوت هيحط الكود تلقائياً في أفضل مكان في الصورة.');
    } catch (err) {
      logger.error('help.handler error:', err);
    }
  });
};
