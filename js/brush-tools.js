import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { RenderEngine } from './render-engine.js';

class PrecisionBrushEngine {
  constructor() {
    this.isDrawing = false;
    this.lastPt = null;
    this.loupeEl = null;
    this.loupeCanvas = null;
    this.loupeCtx = null;
  }

  init() {
    this.loupeEl = document.getElementById('zoom-loupe');
    this.loupeCanvas = document.getElementById('loupe-canvas');
    if (this.loupeCanvas) {
      this.loupeCtx = this.loupeCanvas.getContext('2d');
    }
  }

  canvasToAssetCoords(layer, nx, ny) {
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return null;
    const { width: cw, height: ch } = StateStore.state.canvas;
    const baseScale = (Math.min(cw, ch) / Math.max(asset.width, asset.height)) * layer.scale;
    const drawW = asset.width * baseScale;
    const drawH = asset.height * baseScale;

    const px = nx * cw - layer.x * cw;
    const py = ny * ch - layer.y * ch;
    const rad = (-layer.rotation * Math.PI) / 180;
    let rx = px * Math.cos(rad) - py * Math.sin(rad);
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    if (layer.flipX) rx = -rx;

    const ax = ((rx + drawW / 2) / drawW) * asset.width;
    const ay = ((ry + drawH / 2) / drawH) * asset.height;
    return { x: ax, y: ay, scaleRatio: asset.width / drawW };
  }

  beginStroke(nx, ny) {
    const layer = StateStore.getSelectedLayer();
    if (!layer || !layer.mediaKey) {
      StudioBus.toast('Pilih lapisan foto untuk menggunakan kuas.');
      return;
    }
    this.isDrawing = true;
    this.lastPt = { nx, ny };
    this.applyBrushAt(layer, nx, ny, nx, ny);
    this.updateZoomLoupe(nx, ny);
  }

  continueStroke(nx, ny) {
    if (!this.isDrawing || !this.lastPt) return;
    const layer = StateStore.getSelectedLayer();
    if (!layer) return;
    this.applyBrushAt(layer, this.lastPt.nx, this.lastPt.ny, nx, ny);
    this.lastPt = { nx, ny };
    this.updateZoomLoupe(nx, ny);
  }

  endStroke() {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    this.lastPt = null;
    if (this.loupeEl) this.loupeEl.classList.add('hidden');
    const layer = StateStore.getSelectedLayer();
    if (layer) {
      StateStore.snapshot();
      StudioBus.emit('MASK_UPDATED', { layerId: layer.id });
    }
  }

  applyBrushAt(layer, nx1, ny1, nx2, ny2) {
    const asset = AssetVault.getAsset(layer.mediaKey);
    if (!asset) return;

    const p1 = this.canvasToAssetCoords(layer, nx1, ny1);
    const p2 = this.canvasToAssetCoords(layer, nx2, ny2);
    if (!p1 || !p2) return;

    const mode = StateStore.state.activeToolMode;
    const radius = Math.max(4, Math.round(StateStore.state.brush.size * p2.scaleRatio));

    if (mode === 'BRUSH_ERASE' || mode === 'BRUSH_RESTORE') {
      const mCtx = asset.maskCanvas.getContext('2d');
      mCtx.save();
      mCtx.lineCap = 'round';
      mCtx.lineJoin = 'round';
      mCtx.lineWidth = radius * 2;
      mCtx.strokeStyle = mode === 'BRUSH_ERASE' ? '#000000' : '#ffffff';
      mCtx.beginPath();
      mCtx.moveTo(p1.x, p1.y);
      mCtx.lineTo(p2.x, p2.y);
      mCtx.stroke();
      mCtx.restore();
      RenderEngine.invalidateLayerBuffer(layer.id);
      RenderEngine.requestRender();
    } else if (mode === 'BLEMISH') {
      // Patch-Sample Inpainting lokal (mengambil tekstur sehat di sekitar titik kuas)
      const sCtx = asset.sourceCanvas.getContext('2d');
      const sampleOffset = Math.round(radius * 1.45);
      const sx = Math.max(0, Math.min(asset.width - radius * 2, p2.x + sampleOffset));
      const sy = Math.max(0, Math.min(asset.height - radius * 2, p2.y));

      sCtx.save();
      sCtx.beginPath();
      sCtx.arc(p2.x, p2.y, radius, 0, Math.PI * 2);
      sCtx.clip();
      sCtx.filter = 'blur(1.5px)';
      sCtx.drawImage(asset.sourceCanvas, sx, sy, radius * 2, radius * 2, p2.x - radius, p2.y - radius, radius * 2, radius * 2);
      sCtx.restore();
      RenderEngine.invalidateLayerBuffer(layer.id);
      RenderEngine.requestRender();
    } else if (mode === 'SENSOR') {
      // Kuas Sensor Privasi (Pixelate / Blur untuk Plat Nomor, Wajah & KTP)
      const sCtx = asset.sourceCanvas.getContext('2d');
      const x0 = Math.max(0, Math.round(p2.x - radius));
      const y0 = Math.max(0, Math.round(p2.y - radius));
      const box = Math.min(radius * 2, asset.width - x0, asset.height - y0);
      if (box <= 4) return;

      sCtx.save();
      sCtx.beginPath();
      sCtx.arc(p2.x, p2.y, radius, 0, Math.PI * 2);
      sCtx.clip();

      if (StateStore.state.brush.sensorType === 'blur') {
        sCtx.filter = 'blur(12px)';
        sCtx.drawImage(asset.sourceCanvas, x0, y0, box, box, x0, y0, box, box);
      } else {
        // Pixelate Mosaic
        const block = Math.max(6, Math.round(box / 5));
        const tmp = document.createElement('canvas');
        tmp.width = Math.max(2, Math.round(box / block));
        tmp.height = Math.max(2, Math.round(box / block));
        const tCtx = tmp.getContext('2d');
        tCtx.drawImage(asset.sourceCanvas, x0, y0, box, box, 0, 0, tmp.width, tmp.height);
        sCtx.imageSmoothingEnabled = false;
        sCtx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x0, y0, box, box);
      }
      sCtx.restore();
      RenderEngine.invalidateLayerBuffer(layer.id);
      RenderEngine.requestRender();
    }
  }

  updateZoomLoupe(nx, ny) {
    if (!this.loupeEl || !this.loupeCtx || !RenderEngine.mainCanvas) return;
    this.loupeEl.classList.remove('hidden');

    const mc = RenderEngine.mainCanvas;
    const lw = this.loupeCanvas.width;
    const lh = this.loupeCanvas.height;
    const zoom = 2.5;
    const sampleW = lw / zoom;
    const sampleH = lh / zoom;

    const sx = nx * mc.width - sampleW / 2;
    const sy = ny * mc.height - sampleH / 2;

    this.loupeCtx.clearRect(0, 0, lw, lh);
    this.loupeCtx.drawImage(mc, sx, sy, sampleW, sampleH, 0, 0, lw, lh);
  }
}

export const BrushTools = new PrecisionBrushEngine();
window.StudioCore.brush = BrushTools;
