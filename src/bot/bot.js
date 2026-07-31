const { Telegraf } = require('telegraf');
const config = require('../config/env');
const logger = require('../utils/logger');

const registerStart = require('./handlers/start.handler');
const registerPhoto = require('./handlers/photo.handler');
const registerText = require('./handlers/text.handler');

function createBot() {
  const bot = new Telegraf(config.botToken);

  registerStart(bot);
  registerPhoto(bot);
  registerText(bot);

  // شبكة أمان أخيرة: أي استثناء ما اتمسكش جوه الـ handlers نفسها (حتى لو من خطأ مش متوقع
  // أو مكتبة خارجية) بيوصل هنا بدل ما يوقف البوت كله أو يسيب المستخدم من غير رد
  bot.catch((err, ctx) => {
    logger.error(`خطأ عام غير متوقع (update ${ctx.update?.update_id}):`, err);
    ctx.reply('حصل خطأ غير متوقع، جرب تاني كمان شوية 🙏').catch(() => {});
  });

  return bot;
}

module.exports = { createBot };
