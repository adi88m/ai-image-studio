# Kebijakan Keamanan (Security Policy)

## 🔒 Arsitektur Privasi & Keamanan Data

**AI Image & Background Studio (10-in-1)** dirancang dengan prinsip **Zero-Server / 100% Client-Side Processing**:

1. **Tanpa Unggah ke Server:** Seluruh file gambar, foto pas foto, dokumen hasil scan, tanda tangan digital, maupun teks OCR diproses sepenuhnya secara lokal di dalam memori browser (RAM/WebAssembly/HTML5 Canvas) perangkat pengguna. Tidak ada data visual pengguna yang dikirimkan ke server pengembang maupun server pihak ketiga.
2. **Pembersihan Metadata Otomatis (EXIF & GPS):** Gambar yang diekspor ulang melalui mesin render kanvas secara alami membersihkan metadata EXIF sensitif (koordinat GPS, merek perangkat, dan nomor seri kamera).
3. **Isolasi Sandboxed Iframe:** Saat disematkan di platform blog (`adi88m.blogspot.com`), aplikasi berjalan di dalam atribut `sandbox` terbatas (`allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox`) serta validasi `postMessage` yang ketat.
4. **Pembersihan Memori Lokal:** Buffer kanvas dan `ObjectURL` sementara dibebaskan secara otomatis setelah proses ekspor selesai atau saat lapisan dihapus untuk mencegah kebocoran memori maupun sisa data sesi.

---

## 📦 Versi yang Didukung (Supported Versions)

Hanya rilis terbaru pada cabang utama (`main`) yang mendapatkan pembaruan keamanan dan perbaikan *bug*:

| Versi | Status Dukungan |
| :--- | :--- |
| `v2026.11.x` (Terbaru) | ✅ Didukung Penuh |
| `< v2026.11.0` | ❌ Tidak Didukung |

---

## 🚨 Melaporkan Kerentanan Keamanan (Reporting a Vulnerability)

Jika Anda menemukan celah keamanan (seperti potensi XSS, penyalahgunaan `postMessage`, *bypass* sandboxing, atau masalah keamanan dependensi pihak ketiga), mohon **jangan** mempublikasikannya secara terbuka melalui *GitHub Issues*.

Silakan laporkan secara privat melalui salah satu jalur berikut:

- **GitHub Private Vulnerability Reporting:** Gunakan tombol **"Report a vulnerability"** pada tab **Security** di repositori ini.
- **Kontak Pengembang:** Hubungi admin melalui halaman kontak resmi di **[https://adi88m.blogspot.com](https://adi88m.blogspot.com)** dengan subjek `[SECURITY] AI Image Studio`.

### Informasi yang Perlu Disertakan:
- Deskripsi singkat mengenai jenis kerentanan dan dampaknya.
- Langkah-langkah reproduksi (*steps to reproduce*) atau *Proof of Concept (PoC)*.
- Jenis browser dan sistem operasi yang digunakan saat pengujian.

Laporan akan ditinjau secepatnya dan perbaikan akan segera dirilis pada cabang `main` setelah diverifikasi.
