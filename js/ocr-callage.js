import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault, normalizeImageFile } from './media-loader.js';
import { loadVendorScript } from './vendor-loader.js';

export async function extractTextFromActiveCanvas(lang = 'ind+eng') {
  const layer = StateStore.getSelectedLayer();
  if (!layer || !layer.mediaKey) {
    StudioBus.toast('Unggah gambar berisi tulisan terlebih dahulu.');
    return '';
  }
  const asset = AssetVault.getAsset(layer.mediaKey);
  if (!asset) return '';

  return StudioBus.withLock('ocr_scan', async () => {
    StudioBus.setScanOverlay(true, 'Memuat mesin OCR & membaca teks...', 20);
    try {
      await loadVendorScript('tesseract');
      const result = await window.Tesseract.recognize(asset.sourceCanvas, lang, {
        logger: (m) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            StudioBus.setScanOverlay(true, `Membaca teks (${Math.round(m.progress * 100)}%)...`, 30 + m.progress * 65);
          }
        }
      });
      const text = (result?.data?.text || '').trim();
      if (!text) {
        StudioBus.toast('Tidak ada tulisan yang terdeteksi pada gambar.');
        return '';
      }
      StudioBus.toast('Ekstraksi teks OCR selesai!');
      return text;
    } catch (err) {
      console.error('[OCR]', err);
      StudioBus.toast('Gagal membaca teks OCR. Pastikan koneksi stabil saat unduh pertama.');
      return '';
    } finally {
      StudioBus.setScanOverlay(false);
    }
  });
}

export async function buildAutoCollageFromFiles(fileList, gapPx = 18, bgColor = '#ffffff') {
  const files = [...(fileList || [])].slice(0, 6);
  if (files.length < 2) {
    StudioBus.toast('Pilih minimal 2 hingga 6 foto untuk membuat kolase.');
    return;
  }

  StudioBus.setScanOverlay(true, `Menyusun kolase ${files.length} foto...`, 35);
  try {
    const normalized = [];
    for (const f of files) {
      normalized.push(await normalizeImageFile(f, 1000));
    }

    const total = normalized.length;
    const cols = total <= 2 ? 2 : total <= 4 ? 2 : 3;
    const rows = Math.ceil(total / cols);
    const canvasW = 1200;
    const canvasH = rows === 1 ? 720 : 1200;

    const collageCanvas = document.createElement('canvas');
    collageCanvas.width = canvasW;
    collageCanvas.height = canvasH;
    const ctx = collageCanvas.getContext('2d');

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvasW, canvasH);

    const cellW = Math.floor((canvasW - gapPx * (cols + 1)) / cols);
    const cellH = Math.floor((canvasH - gapPx * (rows + 1)) / rows);

    normalized.forEach((item, idx) => {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const x = gapPx + c * (cellW + gapPx);
      const y = gapPx + r * (cellH + gapPx);

      const scale = Math.max(cellW / item.width, cellH / item.height);
      const dw = item.width * scale;
      const dh = item.height * scale;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, cellW, cellH, 16);
      ctx.clip();
      ctx.drawImage(item.sourceCanvas, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
      ctx.restore();

      // Bebaskan memori sementara
      item.sourceCanvas.width = 0;
      item.maskCanvas.width = 0;
    });

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvasW;
    maskCanvas.height = canvasH;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, canvasW, canvasH);

    const mediaKey = `collage_${Date.now()}`;
    AssetVault.setAsset(mediaKey, {
      sourceCanvas: collageCanvas,
      maskCanvas,
      width: canvasW,
      height: canvasH
    });

    StateStore.state.canvas = { width: canvasW, height: canvasH, aspectLabel: 'Kolase', safeZone: 'none' };
    StateStore.state.layers = [
      StateStore.createLayerObject({
        type: 'subject',
        name: `Kolase ${total} Foto`,
        x: 0.5,
        y: 0.5,
        scale: 1,
        mediaKey
      })
    ];
    StateStore.state.selectedLayerId = StateStore.state.layers[0].id;
    StateStore.snapshot();
    StudioBus.emit('STATE_RESTORED', StateStore.state);
    StudioBus.emit('LAYERS_LIST_CHANGED');
    StudioBus.toast(`Kolase ${total} foto berhasil dibuat!`);
  } finally {
    StudioBus.setScanOverlay(false);
  }
}
