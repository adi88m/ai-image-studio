import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { PixelWorker } from './pixel-worker.js';

export const LUT_PRESETS = {
  none: { label: 'Normal', filter: 'none', tint: null },
  warm: { label: 'Warm Sunset', filter: 'contrast(106%) saturate(118%) sepia(18%)', tint: 'rgba(245, 158, 11, 0.08)' },
  'teal-orange': { label: 'Teal & Orange', filter: 'contrast(114%) saturate(122%)', tint: 'rgba(6, 182, 212, 0.09)' },
  studio: { label: 'Clean Studio', filter: 'brightness(105%) contrast(108%) saturate(104%)', tint: null },
  noir: { label: 'B&W Noir', filter: 'grayscale(100%) contrast(125%)', tint: null },
  pastel: { label: 'Soft Pastel', filter: 'brightness(106%) contrast(94%) saturate(92%)', tint: 'rgba(244, 114, 182, 0.08)' }
};

class ColorHarmonizerEngine {
  async autoEnhanceLayer(layerId) {
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) return;
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return;

    StudioBus.setScanOverlay(true, 'Meningkatkan ketajaman & pencahayaan...', 55);
    try {
      const ctx = asset.sourceCanvas.getContext('2d', { willReadFrequently: true });
      const imgData = ctx.getImageData(0, 0, asset.width, asset.height);
      const enhanced = await PixelWorker.run('AUTO_ENHANCE', imgData);
      ctx.putImageData(enhanced, 0, 0);

      StateStore.snapshot();
      StudioBus.emit('LAYER_UPDATED', { layerId: layer.id });
      StudioBus.toast('Auto-Enhance HD diterapkan!');
    } finally {
      StudioBus.setScanOverlay(false);
    }
  }

  autoMatchColorWithBackground(layerId) {
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer) return;
    const bg = StateStore.state.background;

    let targetWarmth = 0;
    let targetBrightness = 100;

    if (bg.type === 'color' && bg.color) {
      const rgb = this.hexToRgb(bg.color);
      const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
      targetBrightness = Math.round(92 + lum * 16);
      targetWarmth = Math.round(((rgb.r - rgb.b) / 255) * 28);
    } else if (bg.type === 'gradient') {
      targetWarmth = 8;
      targetBrightness = 103;
    }

    layer.adjustments.brightness = targetBrightness;
    layer.adjustments.warmth = targetWarmth;
    layer.adjustments.contrast = 105;

    StateStore.snapshot();
    StudioBus.emit('LAYER_UPDATED', { layerId: layer.id });
    StudioBus.toast('Warna subjek diselaraskan dengan latar belakang!');
  }

  extractDominantPalette(layerId, count = 5) {
    const layer = StateStore.state.layers.find((l) => l.id === layerId) || StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) return ['#ffffff', '#db1514', '#0055b8', '#0f172a', '#6366f1'];
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return ['#ffffff', '#db1514', '#0055b8', '#0f172a', '#6366f1'];

    const ctx = asset.sourceCanvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, asset.width, asset.height).data;
    const buckets = new Map();

    // Sampling cepat tiap 24 piksel
    for (let i = 0; i < data.length; i += 96) {
      const r = Math.round(data[i] / 32) * 32;
      const g = Math.round(data[i + 1] / 32) * 32;
      const b = Math.round(data[i + 2] / 32) * 32;
      const key = `${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }

    const sorted = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([rgbStr]) => {
        const [r, g, b] = rgbStr.split(',').map(Number);
        return this.rgbToHex(r, g, b);
      });

    return sorted.length ? sorted : ['#ffffff', '#0f172a', '#6366f1'];
  }

  buildLayerFilterString(adjustments) {
    const b = adjustments.brightness ?? 100;
    const c = adjustments.contrast ?? 100;
    const s = adjustments.saturate ?? 100;
    const w = adjustments.warmth ?? 0;
    const sepia = w > 0 ? Math.round(w * 0.6) : 0;
    const hue = w < 0 ? Math.round(w * 0.4) : 0;
    return `brightness(${b}%) contrast(${c}%) saturate(${s}%) sepia(${sepia}%) hue-rotate(${hue}deg)`;
  }

  hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }
}

export const ColorEngine = new ColorHarmonizerEngine();
window.StudioCore.color = ColorEngine;
