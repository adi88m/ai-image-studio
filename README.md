# 🎨 AI Image & Background Studio (10-in-1)

Aplikasi web utilitas pengolah gambar & produktivitas visual *all-in-one* yang berjalan **100% client-side** di browser (tanpa backend server, tanpa unggah foto ke pihak ketiga, gratis, dan tanpa watermark paksa).

Dikembangkan oleh **[adi88m](https://adi88m.blogspot.com)** dan dirancang ringan agar berjalan lancar di perangkat mobile maupun desktop, serta mendukung penyematan mulus ke dalam **Blogger (`<iframe>`)**.

🔗 **Live Demo:** [https://adi88m.github.io/ai-image-studio/](https://adi88m.github.io/ai-image-studio/)  
🌐 **Halaman Blog:** [https://adi88m.blogspot.com/p/ai-studio-video.html](https://adi88m.blogspot.com/p/ai-studio-video.html)

---

## ✨ Fitur Utama (10-in-1 Studio)

1. **AI Background Remover (3-Tier Fallback):**
   - Pemisahan subjek & latar belakang otomatis langsung di browser menggunakan WebAssembly/ONNX (`@imgly/background-removal`).
   - Dilengkapi **Magic Wand Flood-Fill** berkecepatan tinggi di Web Worker untuk latar belakang warna solid/polos.
   - **Auto Color-Match & Relighting** untuk menyelaraskan pencahayaan subjek dengan latar belakang baru.
2. **Pas Foto & Lembar Cetak 4R / A4 (300 DPI):**
   - Standar ukuran resmi **2x3 cm, 3x4 cm, 4x6 cm**, dan **Paspor/Visa** dengan warna latar merah (`#db1514`) & biru (`#0055b8`).
   - Panduan simetri kepala & bahu otomatis + generator lembar cetak **4R / A4** lengkap dengan garis panduan gunting (*crop marks*).
3. **Retouch Presisi & Sensor Privasi:**
   - **Kuas Hapus & Kuas Pulih** masker dilengkapi **Zoom Loupe 2.5x** untuk layar sentuh.
   - **Lasso Manual** untuk pemotongan bebas.
   - **Blemish Remover** (penghapus noda/jerawat) & **Kuas Sensor Privasi** (*Pixelate/Blur* untuk plat nomor, wajah, dan NIK KTP).
4. **Studio Produk UMKM & Mockup:**
   - Template latar putih katalog, *Directional Rim Light*, *Cast Floor Shadow*, label promo/diskon, serta **Tiled Watermark Anti-Curi**.
5. **Kompresor Target KB, PDF & Pembersih EXIF:**
   - Kompresi ukuran file presisi menuju target **KB tertentu** (misalnya syarat maksimal `200 KB` untuk pendaftaran administrasi).
   - Konversi satu atau banyak foto sekaligus menjadi dokumen **PDF A4**.
   - **EXIF & GPS Metadata Stripper** untuk menghapus informasi lokasi kamera sebelum foto dibagikan.
6. **CamScanner Dokumen & Ekstraktor Tanda Tangan:**
   - Filter pemindaian **B&W Kontras Tajam** dan **Magic Color** untuk dokumen/struk/KTP.
   - Ekstraksi foto tanda tangan di kertas putih menjadi **stempel PNG transparan** (tinta hitam/biru).
7. **Instagram Grid, Stiker WhatsApp & QR Code:**
   - Pemotong otomatis **IG Grid 3x3** dan **Seamless Carousel 3x1** yang langsung dikemas dalam arsip `.zip`.
   - Ekspor instan **Stiker WhatsApp `512x512` WebP** lengkap dengan *die-cut outline*.
   - Generator **QR Code** kustom yang langsung menjadi lapisan (*layer*) di kanvas.
8. **OCR Ekstrak Teks Lokal & Pembuat Kolase:**
   - Membaca dan menyalin teks dari dalam gambar secara lokal menggunakan `Tesseract.js` (Bahasa Indonesia & Inggris).
   - Penyusun **Kolase Otomatis** untuk 2 hingga 6 foto.
9. **Batch Multi-Image Processor (ZIP):**
   - Ubah ukuran (*resize*), konversi format, dan pasang watermark pada puluhan foto sekaligus dalam satu klik ke dalam file `.zip`.
10. **Arsitektur Multi-Layer Non-Destruktif:**
    - Mendukung banyak lapisan (foto, teks, bentuk), gestur sentuh dua jari (*pinch-to-zoom & rotate*), *Smart Snap Guides*, Undo/Redo, serta mode perbandingan layar belah (*Split Before/After*).

---

## 🏗️ Arsitektur & Struktur Folder

Dibangun dengan **Modular Vanilla ES Modules**, **Web Workers** untuk komputasi piksel berat agar UI tetap responsif 60fps, serta **Memory Watchdog** untuk mencegah *crash* pada ponsel dengan RAM terbatas:

```text
ai-image-studio/
├── index.html                 # Kerangka utama UI & kontainer kanvas
├── manifest.json              # Konfigurasi PWA (Progressive Web App)
├── sw.js                      # Service Worker untuk caching offline-ready
├── .nojekyll                  # Menonaktifkan pemrosesan Jekyll di GitHub Pages
├── README.md                  # Dokumentasi proyek
├── css/
│   └── studio.css             # Desain responsif, tema gelap/terang & isolasi UI
└── js/
    ├── core-bus.js            # Event Bus terpusat, deteksi environment & lock
    ├── vendor-loader.js       # Pemuat pustaka eksternal dinamis (on-demand)
    ├── state-manager.js       # Manajemen state & riwayat Undo/Redo
    ├── media-loader.js        # Normalisasi gambar, EXIF orientation & manajemen RAM
    ├── ai-segmenter.js        # Mesin AI Background Removal 3-Tier & Magic Wand
    ├── pixel-worker.js        # Komputasi piksel & filter dokumen di latar belakang
    ├── color-engine.js        # Ekstraksi palet warna, LUT filter & auto color-match
    ├── render-engine.js       # Mesin render multi-buffer & ekspor resolusi tinggi
    ├── layer-compositor.js    # Kontrol gestur multi-touch, rotasi dinamis & snap guides
    ├── brush-tools.js         # Kuas masker presisi, kaca pembesar 2.5x & sensor privasi
    ├── bg-optics.js           # Latar belakang, bayangan lantai, rim light & safe-zone
    ├── template-presets.js    # Preset komposisi 1-klik & generator watermark
    ├── id-photo-sheet.js      # Standar pas foto resmi & lembar cetak 4R/A4
    ├── doc-scanner.js         # Filter dokumen B&W/Magic Color & ekstraksi TTD PNG
    ├── social-generators.js   # Pemotong IG Grid ZIP, stiker WA 512 & QR Code
    ├── ocr-collage.js         # Ekstraksi teks OCR lokal & generator kolase
    ├── image-optimizer.js     # Kompresor target KB, konverter PDF & EXIF stripper
    ├── exporter-batch.js      # Ekspor multi-format, Web Share API & Batch ZIP
    └── app.js                 # Koordinator utama aplikasi & komunikasi iframe
