import { StudioBus } from './core-bus.js';

const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'adi88m_studio_prefs_v1';

class SafeStorage {
  constructor() {
    this.memory = new Map();
    this.localAvailable = this.checkLocal();
  }

  checkLocal() {
    try {
      const k = '__studio_test__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  getItem(key) {
    if (this.localAvailable) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return this.memory.get(key) || null;
      }
    }
    return this.memory.get(key) || null;
  }

  setItem(key, value) {
    this.memory.set(key, value);
    if (this.localAvailable) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Beralih mulus ke memori tanpa error pada Safari/Incognito
      }
    }
  }

  removeItem(key) {
    this.memory.delete(key);
    if (this.localAvailable) {
      try {
        window.localStorage.removeItem(key);
      } catch {}
    }
  }
}

export const safeStorage = new SafeStorage();

export function clamp(val, min, max, fallback = min) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

class StateManager {
  constructor() {
    this.history = [];
    this.future = [];
    this.maxHistory = 20;
    this.state = this.createInitialState();
    this.loadPreferences();
  }

  createInitialState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      activeHub: 'ai-studio',
      activeToolMode: 'TRANSFORM', // TRANSFORM | BRUSH_ERASE | BRUSH_RESTORE | BLEMISH | SENSOR | LASSO | SPLIT_VIEW
      touchLocked: false,
      splitRatio: 0.5,
      canvas: {
        width: 1080,
        height: 1080,
        aspectLabel: '1:1',
        safeZone: 'none' // none | reels | shorts | pasfoto
      },
      background: {
        type: 'transparent', // transparent | color | gradient | image
        color: '#ffffff',
        gradient: ['#6366f1', '#06b6d4'],
        imageId: null,
        blur: 0,
        vignette: 0
      },
      optics: {
        lut: 'none', // none | warm | teal-orange | studio | noir | pastel
        lutIntensity: 0.8,
        rimLightAngle: 45,
        rimLightIntensity: 0,
        rimLightColor: '#38bdf8',
        floorShadow: 0,
        stickerOutline: 0,
        stickerColor: '#ffffff',
        printProof: false
      },
      layers: [],
      selectedLayerId: null,
      brush: {
        size: 28,
        hardness: 0.85,
        sensorType: 'pixelate' // pixelate | blur
      }
    };
  }

  loadPreferences() {
    try {
      const raw = safeStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.schemaVersion === SCHEMA_VERSION && parsed.theme) {
        document.documentElement.setAttribute('data-theme', parsed.theme === 'light' ? 'light' : 'dark');
      }
    } catch {
      safeStorage.removeItem(STORAGE_KEY);
    }
  }

  saveThemePreference(theme) {
    safeStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, theme }));
  }

  createLayerObject(overrides = {}) {
    return {
      id: overrides.id || `layer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: overrides.type || 'subject', // subject | text | shape | sticker
      name: overrides.name || 'Subjek 1',
      visible: overrides.visible !== false,
      locked: Boolean(overrides.locked),
      opacity: clamp(overrides.opacity ?? 1, 0, 1, 1),
      blendMode: overrides.blendMode || 'source-over',
      x: clamp(overrides.x ?? 0.5, -0.5, 1.5, 0.5),
      y: clamp(overrides.y ?? 0.5, -0.5, 1.5, 0.5),
      scale: clamp(overrides.scale ?? 0.78, 0.05, 5, 0.78),
      rotation: clamp(overrides.rotation ?? 0, -360, 360, 0),
      flipX: Boolean(overrides.flipX),
      adjustments: {
        brightness: clamp(overrides.adjustments?.brightness ?? 100, 30, 200, 100),
        contrast: clamp(overrides.adjustments?.contrast ?? 100, 30, 200, 100),
        saturate: clamp(overrides.adjustments?.saturate ?? 100, 0, 200, 100),
        warmth: clamp(overrides.adjustments?.warmth ?? 0, -50, 50, 0),
        despill: clamp(overrides.adjustments?.despill ?? 0, 0, 100, 0),
        feather: clamp(overrides.adjustments?.feather ?? 1, 0, 10, 1)
      },
      textData: overrides.textData || null,
      shapeData: overrides.shapeData || null,
      mediaKey: overrides.mediaKey || null
    };
  }

  snapshot() {
    const snap = JSON.parse(JSON.stringify({
      canvas: this.state.canvas,
      background: this.state.background,
      optics: this.state.optics,
      layers: this.state.layers,
      selectedLayerId: this.state.selectedLayerId
    }));
    this.history.push(snap);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.future = [];
    this.updateUndoRedoButtons();
  }

  undo() {
    if (this.history.length === 0) return;
    const current = JSON.parse(JSON.stringify({
      canvas: this.state.canvas,
      background: this.state.background,
      optics: this.state.optics,
      layers: this.state.layers,
      selectedLayerId: this.state.selectedLayerId
    }));
    this.future.push(current);

    const prev = this.history.pop();
    Object.assign(this.state, prev);
    this.updateUndoRedoButtons();
    StudioBus.emit('STATE_RESTORED', this.state);
  }

  redo() {
    if (this.future.length === 0) return;
    const current = JSON.parse(JSON.stringify({
      canvas: this.state.canvas,
      background: this.state.background,
      optics: this.state.optics,
      layers: this.state.layers,
      selectedLayerId: this.state.selectedLayerId
    }));
    this.history.push(current);

    const next = this.future.pop();
    Object.assign(this.state, next);
    this.updateUndoRedoButtons();
    StudioBus.emit('STATE_RESTORED', this.state);
  }

  updateUndoRedoButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.disabled = this.history.length === 0;
    if (btnRedo) btnRedo.disabled = this.future.length === 0;
  }

  getSelectedLayer() {
    return this.state.layers.find((l) => l.id === this.state.selectedLayerId) || this.state.layers[0] || null;
  }
}

export const StateStore = new StateManager();
window.StudioCore.state = StateStore;
