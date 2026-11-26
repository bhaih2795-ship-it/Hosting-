const crypto = require('crypto');
const { r, get, set, tg } = require('../lib/db');

const sign = () => crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || '').update('panel-v1').digest('hex');
const eq = (a, b) => {
  a = Buffer.from(String(a || '')); b = Buffer.from(String(b));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const sleep = ms => new Promise(s => setTimeout(s, ms));

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!process.env.ADMIN_PASSWORD) return res.json({ error: 'ADMIN_PASSWORD env set nahi hai' });
    const b = req.body || {};
    if (b.action === 'login') {
      if (eq(b.password, process.env.ADMIN_PASSWORD)) return res.json({ token: sign() });
      return res.status(401).json({ error: 'Wrong password' });
    }
    if (!eq((req.headers.authorization || '').replace('Bearer ', ''), sign()))
      return res.status(401).json({ error: 'Unauthorized' });

    const base = 'https://' + req.headers.host;
    const hook = bot => tg(bot.token, 'setWebhook', {
      url: `${base}/api/hook?id=${bot.id}`, secret_token: bot.secret,
      allowed_updates: ['message'], drop_pending_updates: false
    });

    if (b.action === 'list') {
      const ids = await r(['SMEMBERS', 'bots']);
      const out = [];
      for (const id of ids) {
        const bot = await get('bot:' + id);
        if (!bot) continue;
        const [users, msgs] = await Promise.all([r(['SCARD', `bot:${id}:users`]), r(['GET', `bot:${id}:msgs`])]);
        out.push({ id: bot.id, name: bot.name, username: bot.username, status: bot.status,
          rules: bot.rules || '', fallback: bot.fallback || '', users, msgs: Number(msgs || 0) });
      }
      return res.json({ bots: out });
    }

    if (b.action === 'add') {
      const token = String(b.token || '').trim();
      const me = await tg(token, 'getMe');
      if (!me.ok) return res.json({ error: 'Token galat hai' });
      const id = String(me.result.id);
      let bot = await get('bot:' + id);
      bot = Object.assign({ rules: '/start => Hello {name}! 👋', fallback: '', secret: crypto.randomBytes(16).toString('hex') }, bot || {},
        { id, token, name: me.result.first_name, username: me.result.username, status: 'running' });
      const w = await hook(bot);
      if (!w.ok) return res.json({ error: 'Webhook fail: ' + w.description });
      await set('bot:' + id, bot);
      await r(['SADD', 'bots', id]);
      return res.json({ ok: true });
    }

    const bot = b.id ? await get('bot:' + b.id) : null;
    if (!bot) return res.json({ error: 'Bot not found' });

    if (b.action === 'start') {
      const w = await hook(bot);
      if (!w.ok) return res.json({ error: w.description });
      bot.status = 'running';
    } else if (b.action === 'stop') {
      await tg(bot.token, 'deleteWebhook');
      bot.status = 'stopped';
    } else if (b.action === 'delete') {
      await tg(bot.token, 'deleteWebhook');
      bot.status = 'deleted';
    } else if (b.action === 'restore') {
      bot.status = 'stopped';
    } else if (b.action === 'purge') {
      await tg(bot.token, 'deleteWebhook');
      await r(['DEL', 'bot:' + b.id, `bot:${b.id}:users`, `bot:${b.id}:msgs`]);
      await r(['SREM', 'bots', b.id]);
      return res.json({ ok: true });
    } else if (b.action === 'save') {
      bot.rules = String(b.rules || '').slice(0, 20000);
      bot.fallback = String(b.fallback || '').slice(0, 4000);
    } else if (b.action === 'broadcast') {
      if (bot.status !== 'running') return res.json({ error: 'Bot running hona chahiye' });
      const users = await r(['SMEMBERS', `bot:${b.id}:users`]);
      let sent = 0; const t0 = Date.now();
      for (let i = 0; i < users.length; i += 20) {
        if (Date.now() - t0 > 24000) break;
        const rs = await Promise.all(users.slice(i, i + 20).map(u => tg(bot.token, 'sendMessage', { chat_id: u, text: String(b.text || '') })));
        sent += rs.filter(x => x.ok).length;
        await sleep(1000);
      }
      return res.json({ ok: true, sent, total: users.length });
    } else return res.json({ error: 'Unknown action' });

    await set('bot:' + b.id, bot);
    return res.json({ ok: true });
  } catch (e) { return res.json({ error: e.message }); }
};
