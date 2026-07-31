const { Telegraf } = require('telegraf');
const config = require('../config/env');

const registerStart = require('./handlers/start.handler');
const registerPhoto = require('./handlers/photo.handler');
const registerText = require('./handlers/text.handler');

function createBot() {
  const bot = new Telegraf(config.botToken);

  registerStart(bot);
  registerPhoto(bot);
  registerText(bot);

  return bot;
}

module.exports = { createBot };
