'use strict';
// Awalan "_" = tidak dimuat. Salin file ini jadi features/namafitur.js untuk fitur baru.
module.exports = {
  id: 'contoh',                 // unik, dipakai di toggle settings.json
  name: 'Contoh',
  description: 'Deskripsi singkat fitur',
  defaultEnabled: true,
  allowFromMe: false,           // true bila fitur boleh dipicu pesan dari akun bot sendiri
  commands: ['contoh'],         // dipanggil lewat <prefix>contoh
  async run(ctx) {
    await ctx.reply('Halo dari fitur contoh');
  },
  // async onMessage(ctx) {},   // opsional: dipanggil untuk semua pesan
};
