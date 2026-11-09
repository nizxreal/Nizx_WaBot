# Nizx WaBot

Bot WhatsApp (Baileys) berlisensi token, dijalankan di Termux.

## Persyaratan

- Termux terbaru (dari F-Droid atau GitHub, bukan Play Store)
- Token lisensi dari pemilik (format `NIZXBOT-XXXX-XXXX-XXXX-XXXX`)
- Satu nomor WhatsApp untuk dipasangkan ke bot

## Instal

    pkg update -y && pkg upgrade -y
    pkg install -y nodejs-lts git nano
    git clone https://github.com/nizxreal/Nizx_WaBot
    cd Nizx_WaBot
    npm install
    cp .env.example .env
    nano .env

Di `.env`, isi `LICENSE_TOKEN` dengan token dari pemilik dan `DASHBOARD_PASSWORD`
dengan password pilihanmu. Simpan di nano dengan Ctrl+O, Enter, Ctrl+X.

## Jalankan

    node index.js

Bot memeriksa token ke server lisensi. Bila valid, tekan Enter untuk membuka
dashboard di `http://127.0.0.1:3000` (hanya bisa dibuka dari HP ini). Di dashboard
kamu bisa pairing WhatsApp (kode pairing), melihat status, dan mengatur fitur.

Agar bot tidak tertidur saat layar mati, jalankan `termux-wake-lock`.

## Update

    cd Nizx_WaBot
    git pull
    npm install

Token di `.env` dan sesi WhatsApp di folder `data/` tidak ikut tertimpa.

## Catatan lisensi

- Satu token hanya untuk satu perangkat dan satu nomor WhatsApp.
- Bot berhenti otomatis bila token habis atau dicabut. Hubungi pemilik untuk
  perpanjang, lalu jalankan ulang `node index.js`.
- Bot memeriksa token tiap 3 jam. Tanpa internet, bot berhenti setelah 6 jam.
