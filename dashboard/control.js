'use strict';
// Endpoint kontrol bot. Dipasang setelah middleware login, jadi wajib login.
module.exports = function control(api, bot) {
  api.post('/bot', async (req, res) => {
    try {
      const action = req.body && req.body.action;
      const needSession = () => {
        if (!bot.hasSession()) throw new Error('Belum ada sesi WhatsApp. Lakukan pairing dulu.');
      };
      if (action === 'stop') {
        await bot.stop();
      } else if (action === 'start') {
        needSession();
        if (bot.status !== 'open') await bot.start();
      } else if (action === 'restart') {
        needSession();
        await bot.stop();
        await bot.start();
      } else {
        throw new Error('Aksi tidak dikenal.');
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });
};
