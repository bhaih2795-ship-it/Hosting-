const { r, get, tg } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    const id = req.query.id;
    const bot = await get('bot:' + id);
    if (!bot || bot.status !== 'running' ||
        req.headers['x-telegram-bot-api-secret-token'] !== bot.secret) return res.status(200).send('ok');
    const m = req.body && req.body.message;
    if (!m || !m.chat) return res.status(200).send('ok');
    const chat = m.chat.id;
    await Promise.all([r(['SADD', `bot:${id}:users`, String(chat)]), r(['INCR', `bot:${id}:msgs`])]);
    const text = (m.text || '').trim().toLowerCase().replace(/^(\/\w+)@\w+/, '$1');
    let reply = null;
    for (const line of (bot.rules || '').split('\n')) {
      const i = line.indexOf('=>');
      if (i < 0) continue;
      const k = line.slice(0, i).trim().toLowerCase();
      if (k && (text === k || (k.startsWith('/') && text.startsWith(k + ' ')))) {
        reply = line.slice(i + 2).trim().replace(/\\n/g, '\n');
        break;
      }
    }
    if (reply === null) reply = bot.fallback || '';
    if (reply) {
      reply = reply.replace(/\{name\}/g, (m.from && m.from.first_name) || 'friend');
      await tg(bot.token, 'sendMessage', { chat_id: chat, text: reply });
    }
  } catch (e) { console.error(e); }
  res.status(200).send('ok');
};
