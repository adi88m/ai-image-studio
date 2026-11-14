import { StudioBus } from './core-bus.js';
import { StateStore, clamp } from './state-manager.js';
import { AssetVault } from './media-loader.js';
import { RenderEngine } from './render-engine.js';
import { BrushTools } from './brush-tools.js';
import { AISegmenter } from './ai-segmenter.js';

class LayerCompositorController {
  constructor() {
    this.pointers = new Map();
    this.gestureStart = null;
    this.canvasEl = null;
  }

  init() {
    this.canvasEl = document.getElementById('main-canvas');
    if (!this.canvasEl) return;

    this.canvasEl.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.canvasEl.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.canvasEl.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvasEl.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Split-Screen Before/After Knob Drag
    const knob = document.getElementById('split-knob');
    if (knob) {
      let draggingSplit = false;
      knob.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        draggingSplit = true;
        knob.setPointerCapture(e.pointerId);
      });
      knob.addEventListener('pointermove', (e) => {
        if (!draggingSplit) return;
        const rect = this.canvasEl.getBoundingClientRect();
        const ratio = clamp((e.clientX - rect.left) / rect.width, 0.05, 0.95, 0.5);
        StateStore.state.splitRatio = ratio;
        this.updateSplitSliderDOM(ratio);
        RenderEngine.requestRender();
      });
      knob.addEventListener('pointerup', () => {
        draggingSplit = false;
      });
    }
  }

  updateSplitSliderDOM(ratio) {
    const line = document.querySelector('.split-line');
    const knob = document.getElementById('split-knob');
    const pct = `${Math.round(ratio * 100)}%`;
    if (line) line.style.left = pct;
    if (knob) knob.style.left = pct;
  }

  getNormalizedCoords(e) {
    const rect = this.canvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height)
    };
  }

  onPointerDown(e) {
    if (StateStore.state.touchLocked) return;
    if (StateStore.state.layers.length === 0) return;

    this.canvasEl.setPointerCapture(e.pointerId);
    const pt = this.getNormalizedCoords(e);
    this.pointers.set(e.pointerId, pt);

    const mode = StateStore.state.activeToolMode;

    // Exclusive Mode Routing (Mencegah tabrakan kuas vs geser objek)
    if (mode === 'BRUSH_ERASE' || mode === 'BRUSH_RESTORE' || mode === 'BLEMISH' || mode === 'SENSOR') {
      BrushTools.beginStroke(pt.x, pt.y);
      return;
    }

    if (mode === 'LASSO') {
      RenderEngine.lassoPoints = [pt];
      RenderEngine.requestRender();
      return;
    }

    // Mode TRANSFORM: Pilih lapisan terdekat jika disentuh
    if (this.pointers.size === 1) {
      const hit = this.hitTestLayer(pt.x, pt.y);
      if (hit) {
        StateStore.state.selectedLayerId = hit.id;
        StudioBus.emit('LAYER_SELECTED', { layerId: hit.id });
      }
    }

    const activeLayer = StateStore.getSelectedLayer();
    if (!activeLayer || activeLayer.locked) return;

    if (this.pointers.size === 1) {
      this.gestureStart = {
        mode: 'drag',
        startX: pt.x,
        startY: pt.y,
        origX: activeLayer.x,
        origY: activeLayer.y
      };
    } else if (this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      this.gestureStart = {
        mode: 'pinch',
        startDist: Math.max(0.01, dist),
        startAngle: angle,
        origScale: activeLayer.scale,
        origRotation: activeLayer.rotation
      };
    }
  }

  onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const pt = this.getNormalizedCoords(e);
    this.pointers.set(e.pointerId, pt);

    const mode = StateStore.state.activeToolMode;

    if (mode === 'BRUSH_ERASE' || mode === 'BRUSH_RESTORE' || mode === 'BLEMISH' || mode === 'SENSOR') {
      BrushTools.continueStroke(pt.x, pt.y);
      return;
    }

    if (mode === 'LASSO') {
      RenderEngine.lassoPoints.push(pt);
      RenderEngine.requestRender();
      return;
    }

    const activeLayer = StateStore.getSelectedLayer();
    if (!activeLayer || activeLayer.locked || !this.gestureStart) return;

    if (this.gestureStart.mode === 'drag' && this.pointers.size === 1) {
      let nextX = clamp(this.gestureStart.origX + (pt.x - this.gestureStart.startX), -0.3, 1.3, 0.5);
      let nextY = clamp(this.gestureStart.origY + (pt.y - this.gestureStart.startY), -0.3, 1.3, 0.5);

      // Smart Magnetic Snap Guides (Tengah Horizontal & Vertikal)
      const snapThreshold = 0.022;
      let vSnap = false;
      let hSnap = false;

      if (Math.abs(nextX - 0.5) < snapThreshold) {
        nextX = 0.5;
        vSnap = true;
      }
      if (Math.abs(nextY - 0.5) < snapThreshold) {
        nextY = 0.5;
        hSnap = true;
      }

      if ((vSnap && !RenderEngine.snapGuides.vCenter) || (hSnap && !RenderEngine.snapGuides.hCenter)) {
        if (navigator.vibrate) navigator.vibrate(10);
      }
      RenderEngine.snapGuides = { vCenter: vSnap, hCenter: hSnap };

      activeLayer.x = nextX;
      activeLayer.y = nextY;
      RenderEngine.requestRender();
      } else if (this.gestureStart.mode === 'pinch' && this.pointers.size === 2) {
      const [p1, p2] = [...this.pointers.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

      const scaleFactor = dist / this.gestureStart.startDist;
      activeLayer.scale = clamp(this.gestureStart.origScale * scaleFactor, 0.1, 4.5, 1);

      const deltaDeg = ((angle - this.gestureStart.startAngle) * 180) / Math.PI;
      activeLayer.rotation = Math.round((this.gestureStart.origRotation + deltaDeg) % 360);
      if (activeLayer.mediaKey && StateStore.state.layers.length === 1) {
        const asset = AssetVault.getAsset(activeLayer.mediaKey);
        if (asset) {
          const rad = (activeLayer.rotation * Math.PI) / 180;
          const absCos = Math.abs(Math.cos(rad));
          const absSin = Math.abs(Math.sin(rad));
          StateStore.state.canvas.width = Math.ceil(asset.width * absCos + asset.height * absSin);
          StateStore.state.canvas.height = Math.ceil(asset.width * absSin + asset.height * absCos);
          activeLayer.x = 0.5;
          activeLayer.y = 0.5;
        }
      }

      RenderEngine.requestRender();
    }
  }

  onPointerUp(e) {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.delete(e.pointerId);
    }

    const mode = StateStore.state.activeToolMode;
    if (mode === 'BRUSH_ERASE' || mode === 'BRUSH_RESTORE' || mode === 'BLEMISH' || mode === 'SENSOR') {
      BrushTools.endStroke();
      return;
    }

    if (mode === 'LASSO' && RenderEngine.lassoPoints.length > 3) {
      const sel = StateStore.getSelectedLayer();
      if (sel) AISegmenter.applyPolygonCutout(sel.id, RenderEngine.lassoPoints, true);
      RenderEngine.lassoPoints = [];
      StateStore.state.activeToolMode = 'TRANSFORM';
      RenderEngine.requestRender();
      return;
    }

    if (this.gestureStart) {
      this.gestureStart = null;
      RenderEngine.snapGuides = { vCenter: false, hCenter: false };
      StateStore.snapshot();
      RenderEngine.requestRender();
    }
  }

  hitTestLayer(nx, ny) {
    const layers = StateStore.state.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible) continue;
      const radius = 0.25 * l.scale;
      if (Math.abs(nx - l.x) <= radius && Math.abs(ny - l.y) <= radius) {
        return l;
      }
    }
    return null;
  }

  addTextLayer(text = 'PROMO SPESIAL', font = 'Plus Jakarta Sans') {
    const layer = StateStore.createLayerObject({
      type: 'text',
      name: `Teks: ${text.slice(0, 12)}`,
      x: 0.5,
      y: 0.22,
      scale: 1,
      textData: {
        text,
        font,
        size: 56,
        color: '#ffffff',
        strokeColor: '#0f172a',
        strokeWidth: 6,
        badgeBg: '#6366f1'
      }
    });
    StateStore.state.layers.push(layer);
    StateStore.state.selectedLayerId = layer.id;
    StateStore.snapshot();
    StudioBus.emit('LAYER_UPDATED', { layerId: layer.id });
    StudioBus.emit('LAYERS_LIST_CHANGED');
  }

  addShapeLayer(kind = 'arrow') {
    const names = { arrow: 'Panah Penunjuk', rect: 'Kotak Sorotan', circle: 'Lingkaran' };
    const layer = StateStore.createLayerObject({
      type: 'shape',
      name: names[kind] || 'Bentuk',
      x: 0.5,
      y: 0.5,
      scale: 1,
      shapeData: { kind, color: '#ef4444', fill: 'transparent' }
    });
    StateStore.state.layers.push(layer);
    StateStore.state.selectedLayerId = layer.id;
    StateStore.snapshot();
    StudioBus.emit('LAYER_UPDATED', { layerId: layer.id });
    StudioBus.emit('LAYERS_LIST_CHANGED');
  }
}

export const LayerCompositor = new LayerCompositorController();
window.StudioCore.compositor = LayerCompositor;
