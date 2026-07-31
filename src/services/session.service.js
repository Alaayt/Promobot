/**
 * تخزين مؤقت في الذاكرة لحالة كل مستخدم (chat id)
 * ملحوظة: لو البوت اشتغل على أكتر من instance (scaling)، هيحتاج Redis بدل الـ Map
 */
const sessions = new Map();

function setSession(chatId, data) {
  const current = sessions.get(chatId) || {};
  sessions.set(chatId, { ...current, ...data });
}

function getSession(chatId) {
  return sessions.get(chatId);
}

function clearSession(chatId) {
  sessions.delete(chatId);
}

module.exports = { setSession, getSession, clearSession };
