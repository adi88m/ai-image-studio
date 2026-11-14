import { StudioBus } from './core-bus.js';
import { loadVendorScript } from './vendor-loader.js';

class MediaPool {
  constructor() {
    this.assets = new Map(); // key -> { sourceCanvas, maskCanvas, width, height }
  }

  setAsset(key, data) {
    this.disposeAsset(key);
    this.assets.set(key, data);
  }

  getAsset(key) {
    return this.assets.get(key) || null;
  }

  disposeAsset(key) {
    const existing = this.assets.get(key);
    if (!existing) return;
    if (existing.sourceCanvas) {
      existing.sourceCanvas.width = 0;
      existing.sourceCanvas.height = 0;
    }
    if (existing.maskCanvas) {
      existing.maskCanvas.width = 0;
      existing.maskCanvas.height = 0;
    }
    this.assets.delete(key);
  }

  clearAll() {
    for (const key of this.assets.keys()) {
      this.disposeAsset(key);
    }
  }
}

export const AssetVault = new MediaPool();

async function parseExifOrientation(file) {
  try {
    const slice = file.slice(0, 65536);
    const buffer = await slice.arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0, false) !== 0xffd8) return 1;

    let offset = 2;
    const length = view.byteLength;
    while (offset < length) {
      if (view.getUint16(offset + 2, false) <= 8) return 1;
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffe1) {
        if (view.getUint32((offset += 2), false) !== 0x45786966) return 1;
        const little = view.getUint16((offset += 6), false) === 0x4949;
        offset += view.getUint32(offset + 4, little);
        const tags = view.getUint16(offset, little);
        offset += 2;
        for (let i = 0; i < tags; i++) {
          if (view.getUint16(offset + i * 12, little) === 0x0112) {
            return view.getUint16(offset + i * 12 + 8, little);
          }
        }
      } else if ((marker & 0xff00) !== 0xff00) {
        break;
      } else {
        offset += view.getUint16(offset, false);
      }
    }
  } catch {
    return 1;
  }
  return 1;
}

export async function normalizeImageFile(file, maxDimension = StudioBus.env.maxExportDim) {
  if (!file) throw new Error('File gambar tidak ditemukan.');

  let workingBlob = file;
  const isHeic =
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.hei[cf]$/i.test(file.name || '');

  if (isHeic) {
    StudioBus.setScanOverlay(true, 'Mengonversi foto HEIC iPhone...', 25);
    await loadVendorScript('heic2any');
    const converted = await window.heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92
    });
    workingBlob = Array.isArray(converted) ? converted[0] : converted;
  }

  const orientation = await parseExifOrientation(workingBlob);
  const objectUrl = URL.createObjectURL(workingBlob);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('File gambar rusak atau format tidak didukung.'));
      image.src = objectUrl;
    });

    const swapDims = orientation >= 5 && orientation <= 8;
    const rawW = swapDims ? img.naturalHeight : img.naturalWidth;
    const rawH = swapDims ? img.naturalWidth : img.naturalHeight;

    // Hard Canvas Dimension Guard (Anti-blank white canvas di Safari iOS / Android)
    const scale = Math.min(1, maxDimension / Math.max(rawW, rawH));
    const targetW = Math.max(1, Math.round(rawW * scale));
    const targetH = Math.max(1, Math.round(rawH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.save();
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, targetW, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, targetW, targetH); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, targetH); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, targetW, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, targetW, targetH); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, targetH); break;
      default: break;
    }

    const drawW = swapDims ? targetH : targetW;
    const drawH = swapDims ? targetW : targetH;
    ctx.drawImage(img, 0, 0, drawW, drawH);
    ctx.restore();

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = targetW;
    maskCanvas.height = targetH;
    const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    mCtx.fillStyle = '#ffffff';
    mCtx.fillRect(0, 0, targetW, targetH);

    return {
      sourceCanvas: canvas,
      maskCanvas,
      width: targetW,
      height: targetH
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function generateDemoSampleAsset(type = 'portrait') {
  const w = 720;
  const h = 900;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = w;
  sourceCanvas.height = h;
  const ctx = sourceCanvas.getContext('2d');

  // Latar ruangan simulasi
  const bgGrad = ctx.createLinearGradient(0, 0, w, h);
  if (type === 'product') {
    bgGrad.addColorStop(0, '#cbd5e1');
    bgGrad.addColorStop(1, '#94a3b8');
  } else if (type === 'couple') {
    bgGrad.addColorStop(0, '#fde68a');
    bgGrad.addColorStop(1, '#fca5a5');
  } else {
    bgGrad.addColorStop(0, '#bae6fd');
    bgGrad.addColorStop(1, '#7dd3fc');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Gambar siluet subjek vektor bersih
  ctx.fillStyle = type === 'product' ? '#4f46e5' : '#1e293b';
  if (type === 'product') {
    ctx.beginPath();
    ctx.roundRect(230, 260, 260, 420, 32);
    ctx.fill();
    ctx.fillStyle = '#06b6d4';
    ctx.fillRect(280, 190, 160, 70);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SERUM PRO', 360, 460);
  } else {
    // Kepala & Bahu
    ctx.beginPath();
    ctx.arc(360, 310, 115, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(360, 680, 210, 240, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(150, 680, 420, 220);
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mCtx = maskCanvas.getContext('2d');
  mCtx.fillStyle = '#ffffff';
  mCtx.fillRect(0, 0, w, h);

  return { sourceCanvas, maskCanvas, width: w, height: h };
}
