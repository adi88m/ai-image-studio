import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { LayerCompositor } from './layer-compositor.js';

export const COMPOSITION_TEMPLATES = {
  pasfoto_merah: {
    label: 'Pas Foto Merah 3x4',
    canvas: { width: 900, height: 1200, aspectLabel: '3:4', safeZone: 'pasfoto' },
    background: { type: 'color', color: '#db1514', blur: 0, vignette: 0 },
    optics: { lut: 'studio', floorShadow: 0, rimLightIntensity: 0, stickerOutline: 0 }
  },
  pasfoto_biru: {
    label: 'Pas Foto Biru 3x4',
    canvas: { width: 900, height: 1200, aspectLabel: '3:4', safeZone: 'pasfoto' },
    background: { type: 'color', color: '#0055b8', blur: 0, vignette: 0 },
    optics: { lut: 'studio', floorShadow: 0, rimLightIntensity: 0, stickerOutline: 0 }
  },
  produk_umkm: {
    label: 'Katalog Produk UMKM',
    canvas: { width: 1080, height: 1080, aspectLabel: '1:1', safeZone: 'none' },
    background: { type: 'color', color: '#ffffff', blur: 0, vignette: 0 },
    optics: { lut: 'studio', floorShadow: 65, rimLightIntensity: 0, stickerOutline: 0 },
    addBadge: { text: 'BEST SELLER • DISKON 30%', bg: '#ef4444' }
  },
  couple_warm: {
    label: 'Couple / Sahabat Estetik',
    canvas: { width: 1080, height: 1350, aspectLabel: '4:5', safeZone: 'none' },
    background: { type: 'gradient', gradient: ['#fde68a', '#f472b6'], blur: 0, vignette: 25 },
    optics: { lut: 'warm', floorShadow: 35, rimLightIntensity: 35, rimLightColor: '#fbbf24', stickerOutline: 0 }
  },
  yt_thumbnail: {
    label: 'Thumbnail YouTube Neon',
    canvas: { width: 1280, height: 720, aspectLabel: '16:9', safeZone: 'none' },
    background: { type: 'gradient', gradient: ['#0f172a', '#312e81'], blur: 0, vignette: 40 },
    optics: { lut: 'teal-orange', floorShadow: 0, rimLightIntensity: 70, rimLightColor: '#06b6d4', stickerOutline: 10, stickerColor: '#ffffff' },
    addBadge: { text: 'WAJIB COBA!', bg: '#f59e0b' }
  },
  reels_safe: {
    label: 'Story / Reels / TikTok',
    canvas: { width: 1080, height: 1920, aspectLabel: '9:16', safeZone: 'reels' },
    background: { type: 'gradient', gradient: ['#1e1b4b', '#0f172a'], blur: 0, vignette: 20 },
    optics: { lut: 'studio', floorShadow: 40, rimLightIntensity: 45, rimLightColor: '#38bdf8', stickerOutline: 0 }
  },
  wa_sticker: {
    label: 'Stiker WA Die-Cut',
    canvas: { width: 512, height: 512, aspectLabel: '1:1', safeZone: 'none' },
    background: { type: 'transparent', blur: 0, vignette: 0 },
    optics: { lut: 'studio', floorShadow: 0, rimLightIntensity: 0, stickerOutline: 14, stickerColor: '#ffffff' }
  }
};

export function applyCompositionPreset(presetKey) {
  const preset = COMPOSITION_TEMPLATES[presetKey];
  if (!preset) return;

  Object.assign(StateStore.state.canvas, preset.canvas);
  Object.assign(StateStore.state.background, preset.background);
  Object.assign(StateStore.state.optics, preset.optics);

  // Otomatis rapikan posisi jika ada 2 subjek
  const subjects = StateStore.state.layers.filter((l) => l.type === 'subject');
  if (subjects.length >= 2) {
    subjects[0].x = 0.34;
    subjects[0].y = 0.56;
    subjects[0].scale = 0.72;
    subjects[1].x = 0.66;
    subjects[1].y = 0.56;
    subjects[1].scale = 0.72;
  } else if (subjects.length === 1) {
    subjects[0].x = 0.5;
    subjects[0].y = 0.54;
  }

  if (preset.addBadge) {
    const hasBadge = StateStore.state.layers.some((l) => l.type === 'text');
    if (!hasBadge) {
      LayerCompositor.addTextLayer(preset.addBadge.text, 'Montserrat');
      const last = StateStore.state.layers[StateStore.state.layers.length - 1];
      if (last && last.textData) last.textData.badgeBg = preset.addBadge.bg;
    }
  }

  StateStore.snapshot();
  StudioBus.emit('STATE_RESTORED', StateStore.state);
  StudioBus.toast(`Template "${preset.label}" diterapkan!`);
}

export function generateTiledWatermarkCanvas(sourceCanvas, watermarkText = '© TOKO ORIGINAL') {
  const out = document.createElement('canvas');
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0);

  const fontSize = Math.max(16, Math.round(out.width / 26));
  ctx.save();
  ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", sans-serif`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)';
  ctx.lineWidth = 2;
  ctx.textAlign = 'center';

  const stepX = fontSize * 11;
  const stepY = fontSize * 6;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((-28 * Math.PI) / 180);
  ctx.translate(-out.width / 2, -out.height / 2);

  for (let y = -out.height; y < out.height * 2; y += stepY) {
    for (let x = -out.width; x < out.width * 2; x += stepX) {
      ctx.strokeText(watermarkText, x, y);
      ctx.fillText(watermarkText, x, y);
    }
  }
  ctx.restore();
  return out;
}
