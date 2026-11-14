import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { ColorEngine, LUT_PRESETS } from './color-engine.js';
import { BGOptics } from './bg-optics.js';

class DualResolutionRenderEngine {
  constructor() {
    this.mainCanvas = null;
    this.overlayCanvas = null;
    this.ctx = null;
    this.oCtx = null;
    this.subjectBufferCache = new Map(); // layerId -> { key, canvas }
    this.rafPending = false;
    this.snapGuides = { vCenter: false, hCenter: false };
    this.lassoPoints = [];
  }

  init() {
    this.mainCanvas = document.getElementById('main-canvas');
    this.overlayCanvas = document.getElementById('overlay-canvas');
    if (!this.mainCanvas || !this.overlayCanvas) return;

    this.ctx = this.mainCanvas.getContext('2d', { willReadFrequently: true });
    this.oCtx = this.overlayCanvas.getContext('2d');

    StudioBus.on('LAYER_UPDATED', ({ layerId } = {}) => {
      if (layerId) this.invalidateLayerBuffer(layerId);
      this.requestRender();
    });
    StudioBus.on('MASK_UPDATED', ({ layerId } = {}) => {
      if (layerId) this.invalidateLayerBuffer(layerId);
      this.requestRender();
    });
    StudioBus.on('STATE_RESTORED', () => {
      this.subjectBufferCache.clear();
      this.requestRender();
    });
    StudioBus.on('FORCE_REDRAW', () => this.requestRender());
  }

  invalidateLayerBuffer(layerId) {
    const cached = this.subjectBufferCache.get(layerId);
    if (cached && cached.canvas) {
      cached.canvas.width = 0;
      cached.canvas.height = 0;
    }
    this.subjectBufferCache.delete(layerId);
  }

  requestRender() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.renderPreview();
    });
  }

  getPreviewDimensions() {
    const { width, height } = StateStore.state.canvas;
    const maxDim = StudioBus.env.maxPreviewDim;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    return {
      w: Math.max(200, Math.round(width * scale)),
      h: Math.max(200, Math.round(height * scale)),
      ratio: scale
    };
  }

  composeMaskedSubject(layer, asset) {
    const sig = `${layer.mediaKey}_${layer.adjustments.feather}_${StateStore.state.optics.stickerOutline}_${StateStore.state.optics.stickerColor}`;
    const existing = this.subjectBufferCache.get(layer.id);
    if (existing && existing.sig === sig && existing.canvas.width > 0) {
      return existing.canvas;
    }

    const w = asset.width;
    const h = asset.height;
    const buf = document.createElement('canvas');
    buf.width = w;
    buf.height = h;
    const bCtx = buf.getContext('2d');

    // Gabungkan masker AI/manual ke saluran Alpha
    const maskTmp = document.createElement('canvas');
    maskTmp.width = w;
    maskTmp.height = h;
    const mCtx = maskTmp.getContext('2d');
    if (layer.adjustments.feather > 0) {
      mCtx.filter = `blur(${layer.adjustments.feather}px)`;
    }
    mCtx.drawImage(asset.maskCanvas, 0, 0);

    const sData = asset.sourceCanvas.getContext('2d').getImageData(0, 0, w, h);
    const mData = mCtx.getImageData(0, 0, w, h).data;
    const px = sData.data;

    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = Math.round((px[i + 3] * mData[i]) / 255);
    }

    const maskedCanvas = document.createElement('canvas');
    maskedCanvas.width = w;
    maskedCanvas.height = h;
    maskedCanvas.getContext('2d').putImageData(sData, 0, 0);

    // Vector Sticker Outline (Die-cut border putih/neon jika aktif)
    const outlineSize = StateStore.state.optics.stickerOutline || 0;
    if (outlineSize > 0) {
      BGOptics.drawStickerOutline(bCtx, maskedCanvas, outlineSize, StateStore.state.optics.stickerColor || '#ffffff');
    }

    bCtx.drawImage(maskedCanvas, 0, 0);
    this.subjectBufferCache.set(layer.id, { sig, canvas: buf });
    return buf;
  }

  renderToTargetCanvas(targetCanvas, targetW, targetH, isExport = false) {
    if (!targetCanvas) return;
    targetCanvas.width = targetW;
    targetCanvas.height = targetH;
    const ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, targetW, targetH);

    const state = StateStore.state;
    const lut = LUT_PRESETS[state.optics.lut] || LUT_PRESETS.none;

    ctx.save();
    if (lut.filter !== 'none') {
      ctx.filter = lut.filter;
    }

    // 1. Render Latar Belakang (Warna, Gradasi, Gambar + Bokeh Blur)
    BGOptics.renderBackground(ctx, targetW, targetH, state.background);

    // 2. Render Lapisan Secara Berurutan (Non-Destructive)
    for (const layer of state.layers) {
      if (!layer.visible) continue;

      ctx.save();
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode || 'source-over';

      const cx = layer.x * targetW;
      const cy = layer.y * targetH;
      ctx.translate(cx, cy);
      ctx.rotate((layer.rotation * Math.PI) / 180);
      if (layer.flipX) ctx.scale(-1, 1);

      if (layer.type === 'subject' && layer.mediaKey) {
        const asset = AssetVault.getAsset(layer.mediaKey);
        if (asset) {
          const composed = this.composeMaskedSubject(layer, asset);
          const baseScale = (Math.min(targetW, targetH) / Math.max(asset.width, asset.height)) * layer.scale;
          const drawW = asset.width * baseScale;
          const drawH = asset.height * baseScale;

          // Bayangan Lantai (Cast Floor Shadow)
          if (state.optics.floorShadow > 0) {
            BGOptics.drawCastFloorShadow(ctx, drawW, drawH, state.optics.floorShadow);
          }

          // Filter Pencahayaan & Warna per Subjek
          const prevFilter = ctx.filter;
          const layerFilter = ColorEngine.buildLayerFilterString(layer.adjustments);
          ctx.filter = prevFilter && prevFilter !== 'none' ? `${prevFilter} ${layerFilter}` : layerFilter;

          ctx.drawImage(composed, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.filter = prevFilter;

          // Directional Rim Light
          if (state.optics.rimLightIntensity > 0) {
            BGOptics.drawDirectionalRimLight(ctx, composed, drawW, drawH, state.optics);
          }
        }
      } else if (layer.type === 'text' && layer.textData) {
        this.drawTextLayer(ctx, layer, targetW, targetH);
      } else if (layer.type === 'shape' && layer.shapeData) {
        this.drawShapeLayer(ctx, layer, targetW, targetH);
      }

      ctx.restore();
    }

    // 3. Tint LUT & Vignette Lensa
    if (lut.tint) {
      ctx.fillStyle = lut.tint;
      ctx.fillRect(0, 0, targetW, targetH);
    }
    if (state.background.vignette > 0) {
      BGOptics.drawVignette(ctx, targetW, targetH, state.background.vignette);
    }
    if (state.optics.printProof) {
      // Simulasi gamut warna cetak CMYK ringan
      ctx.fillStyle = 'rgba(248, 245, 238, 0.08)';
      ctx.fillRect(0, 0, targetW, targetH);
    }

    ctx.restore();

    // 4. Split-Screen Before/After Comparison (Hanya saat preview aktif)
    if (!isExport && state.activeToolMode === 'SPLIT_VIEW' && state.layers.length > 0) {
      const firstSub = state.layers.find((l) => l.type === 'subject' && l.mediaKey);
      if (firstSub) {
        const asset = AssetVault.getAsset(firstSub.mediaKey);
        if (asset) {
          const splitX = Math.round(targetW * state.splitRatio);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, splitX, targetH);
          ctx.clip();
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(0, 0, splitX, targetH);
          const fit = Math.min(targetW / asset.width, targetH / asset.height);
          const ow = asset.width * fit;
          const oh = asset.height * fit;
          ctx.drawImage(asset.sourceCanvas, (targetW - ow) / 2, (targetH - oh) / 2, ow, oh);
          ctx.restore();
        }
      }
    }
  }

  drawTextLayer(ctx, layer, targetW, targetH) {
    const td = layer.textData;
    const fontSize = Math.round((td.size || 48) * (targetW / 1080) * layer.scale);
    ctx.font = `700 ${fontSize}px "${td.font || 'Plus Jakarta Sans'}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const text = td.text || 'TEKS STUDIO';
    const metrics = ctx.measureText(text);
    const padX = fontSize * 0.45;
    const padY = fontSize * 0.3;

    if (td.badgeBg && td.badgeBg !== 'transparent') {
      ctx.fillStyle = td.badgeBg;
      ctx.beginPath();
      ctx.roundRect(-metrics.width / 2 - padX, -fontSize / 2 - padY, metrics.width + padX * 2, fontSize + padY * 2, fontSize * 0.25);
      ctx.fill();
    }

    if (td.strokeWidth > 0) {
      ctx.lineWidth = td.strokeWidth * (targetW / 1080);
      ctx.strokeStyle = td.strokeColor || '#0f172a';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, 0, 0);
    }

    ctx.fillStyle = td.color || '#ffffff';
    ctx.fillText(text, 0, 0);
  }

  drawShapeLayer(ctx, layer, targetW) {
    const sd = layer.shapeData;
    const size = Math.round(180 * (targetW / 1080) * layer.scale);
    ctx.strokeStyle = sd.color || '#ef4444';
    ctx.fillStyle = sd.fill || 'transparent';
    ctx.lineWidth = Math.max(3, Math.round(6 * (targetW / 1080)));

    if (sd.kind === 'rect') {
      ctx.beginPath();
      ctx.roundRect(-size / 2, -size * 0.35, size, size * 0.7, 14);
      if (sd.fill && sd.fill !== 'transparent') ctx.fill();
      ctx.stroke();
    } else if (sd.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
      if (sd.fill && sd.fill !== 'transparent') ctx.fill();
      ctx.stroke();
    } else if (sd.kind === 'arrow') {
      const half = size * 0.5;
      ctx.beginPath();
      ctx.moveTo(-half, 0);
      ctx.lineTo(half - 16, 0);
      ctx.stroke();
      ctx.fillStyle = sd.color || '#ef4444';
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half - 24, -14);
      ctx.lineTo(half - 24, 14);
      ctx.closePath();
      ctx.fill();
    }
  }

  renderPreview() {
    if (!this.mainCanvas) return;
    const { w, h } = this.getPreviewDimensions();
    this.renderToTargetCanvas(this.mainCanvas, w, h, false);
    this.renderOverlays(w, h);
  }

  renderOverlays(w, h) {
    if (!this.oCtx) return;
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
    const ctx = this.oCtx;
    ctx.clearRect(0, 0, w, h);

    const state = StateStore.state;

    // 1. Smart Magnetic Snap Guides
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    if (this.snapGuides.vCenter) {
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
    }
    if (this.snapGuides.hCenter) {
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    }
    ctx.restore();

    // 2. Panduan Pas Foto & Social Safe-Zone Overlay
    if (state.canvas.safeZone === 'pasfoto') {
      BGOptics.drawPasFotoGuide(ctx, w, h);
    } else if (state.canvas.safeZone === 'reels' || state.canvas.safeZone === 'shorts') {
      BGOptics.drawSocialSafeZone(ctx, w, h, state.canvas.safeZone);
    }

    // 3. Bounding Box Layer Terpilih (saat mode TRANSFORM)
    const sel = StateStore.getSelectedLayer();
    if (sel && state.activeToolMode === 'TRANSFORM' && state.layers.length > 0) {
      const cx = sel.x * w;
      const cy = sel.y * h;
      const boxSize = Math.min(w, h) * 0.42 * sel.scale;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((sel.rotation * Math.PI) / 180);
      ctx.strokeStyle = sel.locked ? '#ef4444' : 'rgba(99, 102, 241, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-boxSize / 2, -boxSize / 2, boxSize, boxSize);
      ctx.restore();
    }

    // 4. Garis Lasso Manual
    if (this.lassoPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      this.lassoPoints.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x * w, pt.y * h);
        else ctx.lineTo(pt.x * w, pt.y * h);
      });
      ctx.stroke();
      ctx.restore();
    }
  }

  renderHighResExport(scaleMultiplier = 2) {
    const { width, height } = StateStore.state.canvas;
    const maxAllowed = StudioBus.env.maxExportDim;
    const targetMax = Math.min(maxAllowed, Math.max(width, height) * scaleMultiplier);
    const ratio = targetMax / Math.max(width, height);
    const outW = Math.round(width * ratio);
    const outH = Math.round(height * ratio);

    const exportCanvas = document.createElement('canvas');
    this.renderToTargetCanvas(exportCanvas, outW, outH, true);
    return exportCanvas;
  }
}

export const RenderEngine = new DualResolutionRenderEngine();
window.StudioCore.renderer = RenderEngine;
