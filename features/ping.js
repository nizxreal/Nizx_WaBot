'use strict';
module.exports = {
  id: 'ping',
  name: 'Ping',
  description: 'Cek bot hidup dan latensi pesan',
  defaultEnabled: true,
  allowFromMe: true, // agar bisa diuji lewat chat ke diri sendiri
  commands: ['ping'],
  async run(ctx) {
    const ts = Number(ctx.msg.messageTimestamp);
    const lag = ts ? Math.max(0, Date.now() - ts * 1000) : null;
    await ctx.reply(lag === null ? 'Pong!' : `Pong! (${lag} ms)`);
  },
};
