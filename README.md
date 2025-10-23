# TikTok Downloader Backend (Vercel)

**Versi:** Lengkap (HD + MP3 fallback otomatis)

Ini adalah contoh backend serverless untuk digunakan bersama frontend TikTok downloader.
- Teknologi: Node.js + Vercel Serverless Function
- Fungsi utama: `GET /api/download?url=<tiktok-url>&format=mp4|mp4hd|mp3`

## Fitur
- Mencoba mengambil URL video terbaik (HD jika diminta) dari layanan lookup (TikMate).
- Jika format `mp3` diminta, backend akan mencoba menggunakan layanan converter eksternal jika Anda mengatur `CONVERTER_API` sebagai environment variable.
- Jika konverter tidak tersedia, backend akan mengembalikan `downloadUrl` video — frontend dapat menampilkan instruksi untuk konversi lokal.

## Cara pakai (lokal)
1. Install dependensi:
   ```bash
   npm install
   ```
2. Jalankan:
   ```bash
   node api/download.js
   ```
   > Catatan: Vercel menjalankan file ini sebagai serverless function. Untuk testing lokal gunakan `vercel dev` atau setup Express.

## Deploy ke Vercel
1. Push repo ini ke GitHub.
2. Import project ke Vercel (https://vercel.com/new).
3. Atur environment variable (opsional):
   - `CONVERTER_API` — URL POST ke layanan konversi yang menerima JSON `{ "url": "<videoUrl>" }` dan mengembalikan `{ "downloadUrl": "https://...", "size": "...", "title": "..." }`.
4. Deploy. Endpoint akan tersedia pada `https://<your-project>.vercel.app/api/download`.

## Catatan penting
- Layanan lookup publik (mis. TikMate) dapat berubah atau dibatasi sewaktu-waktu. Jika lookup gagal, backend mengembalikan payload lookup untuk debugging.
- Konversi MP3 tidak dilakukan secara otomatis oleh kode ini kecuali Anda sediakan layanan konverter (karena serverless environment seperti Vercel tidak selalu cocok untuk menjalankan ffmpeg).
- Jangan gunakan layanan ini untuk melanggar hak cipta atau ketentuan TikTok.

