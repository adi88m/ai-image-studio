import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { RenderEngine } from './render-engine.js';
import { loadVendorScript } from './vendor-loader.js';

export async function splitInstagramGridAndZip(rows = 3, cols = 3) {
  const source = RenderEngine.renderHighResExport(2);
  if (!source || source.width < 10) {
    StudioBus.toast('Tambahkan gambar ke kanvas terlebih dahulu.');
    return;
  }

  StudioBus.setScanOverlay(true, `Memotong grid ${cols}x${rows} & mengemas ZIP...`, 40);
  try {
    await loadVendorScript('jszip');
    const zip = new window.JSZip();
    const tileW = Math.floor(source.width / cols);
    const tileH = Math.floor(source.height / rows);

    let index = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tile = document.createElement('canvas');
        tile.width = tileW;
        tile.height = tileH;
        const tCtx = tile.getContext('2d');
        tCtx.drawImage(source, c * tileW, r * tileH, tileW, tileH, 0, 0, tileW, tileH);

        const blob = await new Promise((res) => tile.toBlob(res, 'image/jpeg', 0.94));
        const padIdx = String(index).padStart(2, '0');
        zip.file(`ig_grid_${cols}x${rows}_bagian_${padIdx}.jpg`, blob);
        index++;
      }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerDirectDownload(zipBlob, `adi88m_ig_grid_${cols}x${rows}.zip`);
    StudioBus.toast(`Berhasil memotong ${rows * cols} bagian grid dalam arsip ZIP!`);
  } finally {
    StudioBus.setScanOverlay(false);
  }
}

export async function exportWhatsAppSticker512() {
  const prevW = StateStore.state.canvas.width;
  const prevH = StateStore.state.canvas.height;
  const prevBg = StateStore.state.background.type;
  const prevOutline = StateStore.state.optics.stickerOutline;

  StateStore.state.canvas.width = 512;
  StateStore.state.canvas.height = 512;
  StateStore.state.background.type = 'transparent';
  if (prevOutline === 0) StateStore.state.optics.stickerOutline = 12;

  const stickerCanvas = RenderEngine.renderHighResExport(1);

  // Kembalikan state tampilan awal
  StateStore.state.canvas.width = prevW;
  StateStore.state.canvas.height = prevH;
  StateStore.state.background.type = prevBg;
  StateStore.state.optics.stickerOutline = prevOutline;
  RenderEngine.requestRender();

  const blob = await new Promise((res) => stickerCanvas.toBlob(res, 'image/webp', 0.9));
  triggerDirectDownload(blob, `stiker_wa_adi88m_${Date.now()}.webp`);
  StudioBus.toast('Stiker WhatsApp 512x512 WebP siap digunakan!');
}

export async function generateQRCodeLayer(textUrl = 'https://adi88m.blogspot.com', fgColor = '#0f172a') {
  const cleanText = (textUrl || '').trim();
  if (!cleanText) {
    StudioBus.toast('Masukkan tautan atau teks untuk membuat QR Code.');
    return;
  }

  StudioBus.setScanOverlay(true, 'Membuat QR Code...', 45);
  try {
    await loadVendorScript('qrcode');
    const qrCanvas = document.createElement('canvas');
    await window.QRCode.toCanvas(qrCanvas, cleanText, {
      width: 480,
      margin: 2,
      color: { dark: fgColor, light: '#ffffff' }
    });

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = qrCanvas.width;
    maskCanvas.height = qrCanvas.height;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

    const mediaKey = `qr_${Date.now()}`;
    AssetVault.setAsset(mediaKey, {
      sourceCanvas: qrCanvas,
      maskCanvas,
      width: qrCanvas.width,
      height: qrCanvas.height
    });

    const layer = StateStore.createLayerObject({
      type: 'subject',
      name: 'QR Code',
      x: 0.82,
      y: 0.82,
      scale: 0.28,
      mediaKey
    });

    StateStore.state.layers.push(layer);
    StateStore.state.selectedLayerId = layer.id;
    StateStore.snapshot();
    StudioBus.emit('LAYER_UPDATED', { layerId: layer.id });
    StudioBus.emit('LAYERS_LIST_CHANGED');
    StudioBus.toast('QR Code ditambahkan ke kanvas!');
  } finally {
    StudioBus.setScanOverlay(false);
  }
}

function triggerDirectDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
