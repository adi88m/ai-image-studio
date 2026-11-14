import { StudioBus } from './core-bus.js';
import { loadVendorESModule } from './vendor-loader.js';
import { AssetVault } from './media-loader.js';
import { StateStore } from './state-manager.js';

class AISegmenterEngine {
  constructor() {
    this.removeBgFn = null;
    this.isModelCached = false;
  }

  async ensureModelLoaded() {
    if (this.removeBgFn) return this.removeBgFn;

    StudioBus.setScanOverlay(true, 'Menyiapkan mesin AI lokal (~25MB sekali unduh)...', 12);
    const mod = await loadVendorESModule('imglyBg');
    const fn = mod.removeBackground || mod.default?.removeBackground || mod.default;
    if (typeof fn !== 'function') {
      throw new Error('Fungsi AI Segmenter tidak ditemukan pada modul.');
    }
    this.removeBgFn = fn;
    return fn;
  }

  // Tier 1: AI Deep Learning WebAssembly (Single-Threaded aman untuk GitHub Pages)
  async runAISegmentation(layerId) {
    return StudioBus.withLock('ai_segment', async () => {
      const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
      if (!layer || !layer.mediaKey) {
        StudioBus.toast('Pilih lapisan foto terlebih dahulu.');
        return false;
      }

      const asset = AssetVault.getAsset(layer.mediaKey);
      if (!asset || !asset.sourceCanvas) return false;

      try {
        const removeBackground = await this.ensureModelLoaded();
        StudioBus.setScanOverlay(true, 'Memindai objek & memisahkan latar...', 35);

        const inputBlob = await new Promise((res) => asset.sourceCanvas.toBlob(res, 'image/png'));
        const resultBlob = await removeBackground(inputBlob, {
          device: 'cpu',
          numThreads: 1, // Menghindari kebutuhan header COOP/COEP di GitHub Pages
          proxyToWorker: true,
          model: 'medium',
          output: { format: 'image/png', type: 'foreground' },
          progress: (key, current, total) => {
            if (total > 0) {
              const pct = Math.min(95, Math.round((current / total) * 100));
              const label = key.includes('fetch')
                ? `Mengunduh model AI (${pct}%)...`
                : `Memotong latar belakang (${pct}%)...`;
              StudioBus.setScanOverlay(true, label, pct);
            }
          }
        });

        this.isModelCached = true;
        StudioBus.setScanOverlay(true, 'Menyempurnakan tepi masker...', 98);

        const url = URL.createObjectURL(resultBlob);
        try {
          const fgImg = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
          });

          // Ekstrak saluran Alpha hasil AI ke maskCanvas non-destruktif
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = asset.width;
          tempCanvas.height = asset.height;
          const tCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
          tCtx.drawImage(fgImg, 0, 0, asset.width, asset.height);

          const fgData = tCtx.getImageData(0, 0, asset.width, asset.height);
          const mCtx = asset.maskCanvas.getContext('2d', { willReadFrequently: true });
          const maskData = mCtx.createImageData(asset.width, asset.height);

          const src = fgData.data;
          const dst = maskData.data;
          for (let i = 0; i < src.length; i += 4) {
            const alpha = src[i + 3];
            dst[i] = alpha;
            dst[i + 1] = alpha;
            dst[i + 2] = alpha;
            dst[i + 3] = 255;
          }
          mCtx.putImageData(maskData, 0, 0);
        } finally {
          URL.revokeObjectURL(url);
        }

        StateStore.snapshot();
        StudioBus.emit('MASK_UPDATED', { layerId: layer.id });
        StudioBus.toast('Latar belakang berhasil dihapus otomatis!');
        return true;
      } catch (err) {
        console.warn('[AISegmenter] Beralih ke Mode Magic Wand Instan:', err);
        StudioBus.toast('AI offline/lambat. Gunakan Magic Wand Instan (0 KB) untuk latar polos.');
        return false;
      } finally {
        StudioBus.setScanOverlay(false);
      }
    });
  }

  // Tier 2: Edge-Aware Magic Wand Flood-Fill (0 KB unduhan, instan untuk pas foto / latar polos)
  runMagicWandFloodFill(layerId, normX = 0.04, normY = 0.04, tolerance = 38) {
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) return false;
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return false;

    const w = asset.width;
    const h = asset.height;
    const sx = Math.max(0, Math.min(w - 1, Math.round(normX * w)));
    const sy = Math.max(0, Math.min(h - 1, Math.round(normY * h)));

    const sCtx = asset.sourceCanvas.getContext('2d', { willReadFrequently: true });
    const mCtx = asset.maskCanvas.getContext('2d', { willReadFrequently: true });
    const imgData = sCtx.getImageData(0, 0, w, h).data;
    const maskImg = mCtx.getImageData(0, 0, w, h);
    const mask = maskImg.data;

    const startIdx = (sy * w + sx) * 4;
    const targetR = imgData[startIdx];
    const targetG = imgData[startIdx + 1];
    const targetB = imgData[startIdx + 2];
    const tolSq = tolerance * tolerance * 3;

    const visited = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let ptr = 0;

    // Mulai dari titik klik maupun 4 sudut kanvas jika menggunakan nilai default
    const seeds = normX === 0.04 && normY === 0.04
      ? [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]
      : [[sx, sy]];

    for (const [px, py] of seeds) {
      const idx = py * w + px;
      if (!visited[idx]) {
        visited[idx] = 1;
        stack[ptr++] = idx;
      }
    }

    while (ptr > 0) {
      const curr = stack[--ptr];
      const cx = curr % w;
      const cy = (curr - cx) / w;
      const pIdx = curr * 4;

      const dr = imgData[pIdx] - targetR;
      const dg = imgData[pIdx + 1] - targetG;
      const db = imgData[pIdx + 2] - targetB;
      const distSq = dr * dr + dg * dg + db * db;

      if (distSq <= tolSq) {
        // Feathering halus di batas toleransi
        const featherAlpha = distSq > tolSq * 0.72
          ? Math.round(((distSq - tolSq * 0.72) / (tolSq * 0.28)) * 255)
          : 0;
        mask[pIdx] = featherAlpha;
        mask[pIdx + 1] = featherAlpha;
        mask[pIdx + 2] = featherAlpha;
        mask[pIdx + 3] = 255;

        if (cx > 0 && !visited[curr - 1]) { visited[curr - 1] = 1; stack[ptr++] = curr - 1; }
        if (cx < w - 1 && !visited[curr + 1]) { visited[curr + 1] = 1; stack[ptr++] = curr + 1; }
        if (cy > 0 && !visited[curr - w]) { visited[curr - w] = 1; stack[ptr++] = curr - w; }
        if (cy < h - 1 && !visited[curr + w]) { visited[curr + w] = 1; stack[ptr++] = curr + w; }
      }
    }

    mCtx.putImageData(maskImg, 0, 0);
    StateStore.snapshot();
    StudioBus.emit('MASK_UPDATED', { layerId: layer.id });
    StudioBus.toast('Potongan latar instan diterapkan.');
    return true;
  }

  // Tier 3: Magnetic Polygon / Lasso Cutout
  applyPolygonCutout(layerId, normPoints, keepInside = true) {
    if (!normPoints || normPoints.length < 3) return false;
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) return false;
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return false;

    const w = asset.width;
    const h = asset.height;
    const mCtx = asset.maskCanvas.getContext('2d');

    mCtx.save();
    if (keepInside) {
      mCtx.fillStyle = '#000000';
      mCtx.fillRect(0, 0, w, h);
    }
    mCtx.beginPath();
    normPoints.forEach((pt, idx) => {
      const px = pt.x * w;
      const py = pt.y * h;
      if (idx === 0) mCtx.moveTo(px, py);
      else mCtx.lineTo(px, py);
    });
    mCtx.closePath();
    mCtx.fillStyle = keepInside ? '#ffffff' : '#000000';
    mCtx.fill();
    mCtx.restore();

    StateStore.snapshot();
    StudioBus.emit('MASK_UPDATED', { layerId: layer.id });
    StudioBus.toast('Area seleksi Lasso berhasil diterapkan.');
    return true;
  }

  resetMask(layerId) {
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) return;
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return;
    const mCtx = asset.maskCanvas.getContext('2d');
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, asset.width, asset.height);
    StateStore.snapshot();
    StudioBus.emit('MASK_UPDATED', { layerId: layer.id });
    StudioBus.toast('Masker foto dipulihkan ke penuh.');
  }
}

export const AISegmenter = new AISegmenterEngine();
window.StudioCore.segmenter = AISegmenter;
