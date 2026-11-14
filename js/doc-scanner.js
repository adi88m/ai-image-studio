import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { PixelWorker } from './pixel-worker.js';
import { RenderEngine } from './render-engine.js';

export async function applyDocumentScanFilter(mode = 'bw') {
  const layer = StateStore.getSelectedLayer();
  if (!layer || !layer.mediaKey) {
    StudioBus.toast('Unggah foto dokumen/struk terlebih dahulu.');
    return;
  }
  const asset = AssetVault.getAsset(layer.mediaKey);
  if (!asset) return;

  StudioBus.setScanOverlay(true, 'Memproses pemindaian dokumen tajam...', 50);
  try {
    const ctx = asset.sourceCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, asset.width, asset.height);
    const scanned = await PixelWorker.run('DOC_SCAN_FILTER', imgData, { mode });
    ctx.putImageData(scanned, 0, 0);

    RenderEngine.invalidateLayerBuffer(layer.id);
    StateStore.snapshot();
    RenderEngine.requestRender();
    StudioBus.toast(mode === 'bw' ? 'Filter Dokumen B&W Tajam diterapkan!' : 'Filter Magic Color diterapkan!');
  } finally {
    StudioBus.setScanOverlay(false);
  }
}

export async function extractTransparentSignature(tint = 'black') {
  const layer = StateStore.getSelectedLayer();
  if (!layer || !layer.mediaKey) {
    StudioBus.toast('Unggah foto tanda tangan di kertas putih terlebih dahulu.');
    return;
  }
  const asset = AssetVault.getAsset(layer.mediaKey);
  if (!asset) return;

  StudioBus.setScanOverlay(true, 'Mengekstrak tanda tangan transparan...', 60);
  try {
    const sCtx = asset.sourceCanvas.getContext('2d', { willReadFrequently: true });
    const mCtx = asset.maskCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = sCtx.getImageData(0, 0, asset.width, asset.height);
    const sigData = await PixelWorker.run('EXTRACT_SIGNATURE', imgData, { tint });

    // Salin saluran alpha ke maskCanvas & warna tinta ke sourceCanvas
    const maskImg = mCtx.createImageData(asset.width, asset.height);
    const px = sigData.data;
    const mPx = maskImg.data;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      mPx[i] = a;
      mPx[i + 1] = a;
      mPx[i + 2] = a;
      mPx[i + 3] = 255;
      px[i + 3] = 255;
    }

    sCtx.putImageData(sigData, 0, 0);
    mCtx.putImageData(maskImg, 0, 0);
    StateStore.state.background.type = 'transparent';

    RenderEngine.invalidateLayerBuffer(layer.id);
    StateStore.snapshot();
    StudioBus.emit('STATE_RESTORED', StateStore.state);
    StudioBus.toast('Tanda tangan berhasil diekstrak menjadi stempel transparan PNG!');
  } finally {
    StudioBus.setScanOverlay(false);
  }
}

export function straightenDocumentPerspective(cropMarginPct = 0.06) {
  const layer = StateStore.getSelectedLayer();
  if (!layer || !layer.mediaKey) return;
  const asset = AssetVault.getAsset(layer.mediaKey);
  if (!asset) return;

  // Auto-Trim tepi meja & normalisasi proporsi dokumen tegak lurus
  const marginX = Math.round(asset.width * cropMarginPct);
  const marginY = Math.round(asset.height * cropMarginPct);
  const newW = Math.max(100, asset.width - marginX * 2);
  const newH = Math.max(100, asset.height - marginY * 2);

  const cropped = document.createElement('canvas');
  cropped.width = newW;
  cropped.height = newH;
  cropped.getContext('2d').drawImage(asset.sourceCanvas, marginX, marginY, newW, newH, 0, 0, newW, newH);

  const newMask = document.createElement('canvas');
  newMask.width = newW;
  newMask.height = newH;
  newMask.getContext('2d').fillStyle = '#ffffff';
  newMask.getContext('2d').fillRect(0, 0, newW, newH);

  AssetVault.setAsset(layer.mediaKey, {
    sourceCanvas: cropped,
    maskCanvas: newMask,
    width: newW,
    height: newH
  });

  StateStore.state.canvas.width = newW;
  StateStore.state.canvas.height = newH;
  layer.x = 0.5;
  layer.y = 0.5;
  layer.rotation = 0;
  layer.scale = 1;

  RenderEngine.invalidateLayerBuffer(layer.id);
  StateStore.snapshot();
  StudioBus.emit('STATE_RESTORED', StateStore.state);
  StudioBus.toast('Bingkai dokumen dirapikan tegak lurus!');
}
