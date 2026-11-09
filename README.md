# Nizx WaBot

Bot WhatsApp berlisensi token yang dijalankan di HP Android lewat Termux.
Kamu butuh token dari pemilik untuk memakainya.

## Yang perlu disiapkan

- HP Android dengan ruang kosong sekitar 500 MB dan internet yang stabil
- Token dari pemilik, bentuknya `NIZXBOT-XXXX-XXXX-XXXX-XXXX`
- Nomor WhatsApp yang akan dijadikan bot, aktif di HP yang kamu pegang

Satu token hanya untuk satu HP dan satu nomor WhatsApp.

## Langkah 1: Pasang Termux

Unduh Termux dari F-Droid (f-droid.org, cari "Termux") atau dari halaman rilis
GitHub: github.com/termux/termux-app/releases. Hindari versi Play Store karena
sering bermasalah saat memasang paket. Buka Termux dan tunggu sampai muncul
tanda `$`.

## Langkah 2: Pasang bot dengan satu perintah

Tempel perintah ini di Termux (tekan lama layar, pilih Paste), lalu Enter:

    curl -fsSL https://raw.githubusercontent.com/nizxreal/Nizx_WaBot/main/install.sh -o install.sh && bash install.sh

Skrip memasang semua yang dibutuhkan dan menjalankan bot. Prosesnya beberapa
menit. Kalau ada pertanyaan `[Y/n]`, ketik `y`. Kalau muncul pilihan file
konfigurasi, tekan Enter.

Kalau muncul `curl: not found`, ketik `pkg install -y curl` lalu ulangi perintah di atas.

## Langkah 3: Masukkan token di halaman web

Setelah selesai, Termux menampilkan **Kode setup** dan membuka browser ke
`http://127.0.0.1:3000` (alamat ini hanya bisa dibuka dari HP kamu sendiri).
Kalau browser tidak terbuka, buka Chrome dan ketik alamat itu sendiri. Jangan
tutup Termux; cukup pindah aplikasi.

Di halaman **Pengaturan awal**:

1. Kode setup biasanya sudah terisi. Kalau kosong, ketik kode 6 digit dari Termux.
2. Tempel token dari pemilik.
3. Buat password dashboard (minimal 8 karakter), ulangi, lalu tekan **Simpan dan mulai**.

## Langkah 4: Hubungkan WhatsApp

1. Di kartu **Kontrol**, isi **Nomor WhatsApp Bot** dengan format `628xxxxxxxxxx`
   (tanpa `+`, tanpa spasi, tanpa `0` di depan), pilih **Kode pairing**, lalu
   tekan **Hubungkan**.
2. Kode muncul di kartu **Koneksi Bot**. Ketuk kode itu untuk menyalinnya.
3. Buka WhatsApp di nomor tersebut: **Pengaturan > Perangkat tertaut >
   Tautkan perangkat > Tautkan dengan nomor telepon**, lalu masukkan kodenya.
   Kode hanya berlaku sekitar 1 menit.
4. Status berubah menjadi **Terhubung**. Bot siap dipakai.

Nomor yang dipairing pertama kali akan terikat ke token. Nomor lain ditolak.

## Pemakaian sehari-hari

- **Menjalankan bot:** ketik `nizxbot` di Termux. Tidak perlu pairing ulang.
  Buka dashboard dengan Enter (atau Chrome ke `http://127.0.0.1:3000`).
- **Menghentikan bot:** tekan CTRL (baris tombol tambahan Termux) lalu `c`.
- **Update bot:** `nizxbot update`, lalu `nizxbot`.
- **Atur fitur:** di dashboard, kartu Fitur dan Pengaturan. Berlaku tanpa restart.
- **Agar bot tidak mati sendiri:** jangan tutup Termux dari daftar aplikasi.
  Di Pengaturan HP > Aplikasi > Termux > Baterai, pilih **Tanpa batasan**.

## Masa aktif token

- Bot memeriksa token saat mulai dan tiap 3 jam. Tanpa internet, bot berhenti
  setelah 6 jam.
- Saat masa aktif habis, bot mengirim pesan ke chat dirimu sendiri lalu berhenti.
  Dashboard tetap bisa dibuka dan menampilkan alasannya.
- Setelah pemilik memperpanjang token, buka dashboard lalu tekan
  **Cek ulang lisensi**. Tidak perlu instal atau pairing ulang.

## Pindah HP, ganti nomor, ganti token

- **Pindah HP:** hubungi pemilik lebih dulu. Hentikan bot di HP lama, tunggu
  pemilik melepas ikatan, lalu ulangi Langkah 2-4 di HP baru dengan token yang sama.
- **Ganti nomor WhatsApp:** hubungi pemilik untuk melepas ikatan nomor.
- **Ganti token:** saat lisensi bermasalah, dashboard menampilkan kolom token.
  Atau hentikan bot, ketik `rm ~/Nizx_WaBot/data/license.json`, lalu jalankan
  `nizxbot` dan buka dashboard.

## Masalah umum

- `Token tidak ditemukan`: salah ketik. Tempel ulang tokennya di dashboard.
- `Token sudah terikat ke perangkat lain`: token dipakai di HP lain. Hubungi pemilik.
- `Token terikat ke nomor WhatsApp lain`: nomor berbeda dari pairing pertama.
- `Masa aktif token habis` atau `Token sudah dicabut`: hubungi pemilik.
- `Server lisensi tidak terjangkau`: periksa internet, lalu tekan Cek ulang lisensi.
- `Port 3000 dipakai`: bot lain masih berjalan. Ketik `pkill -f "node index.js"`
  lalu jalankan `nizxbot` lagi.
- Kode setup salah atau hilang: hentikan bot dan jalankan `nizxbot` lagi untuk kode baru.
- Kode pairing ditolak: sudah kedaluwarsa. Tekan Hubungkan lagi untuk kode baru.
- `pkg` error atau tidak menemukan paket: ketik `termux-change-repo`, pilih
  mirror lain, lalu ulangi perintah di Langkah 2.
- Lupa password dashboard: hentikan bot, ketik `rm ~/Nizx_WaBot/data/dashboard.json`,
  lalu jalankan `nizxbot` untuk membuat password baru (sesi WhatsApp tidak terhapus).
