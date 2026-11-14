export const APP_VERSION = '2026.11.1';
export const BASE_URI = new URL('../', import.meta.url).href;

class EventBus {
  constructor() {
    this.listeners = new Map();
    this.locks = new Set();
    this.taskQueues = new Map();
    this.env = this.detectEnvironment();
  }

  detectEnvironment() {
    const ua = navigator.userAgent || '';
    const isInIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    const isInAppWebView = /FBAN|FBAV|Instagram|TikTok|BytedanceWebview|Line\/|WhatsApp/i.test(ua);
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const deviceMemory = navigator.deviceMemory || (isIOS ? 3 : 4);
    const isLowMemory = deviceMemory <= 4 || isInAppWebView;

    return {
      isInIframe,
      isInAppWebView,
      isIOS,
      deviceMemory,
      isLowMemory,
      maxPreviewDim: isLowMemory ? 820 : 1080,
      maxExportDim: isLowMemory ? 1800 : 2800
    };
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) set.delete(callback);
  }

  emit(event, payload = {}) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[StudioBus:${event}]`, err);
      }
    });
  }

  async withLock(lockKey, asyncFn) {
    if (this.locks.has(lockKey)) {
      this.toast('Sedang memproses tugas sebelumnya, harap tunggu...');
      return null;
    }
    this.locks.add(lockKey);
    try {
      return await asyncFn();
    } finally {
      this.locks.delete(lockKey);
    }
  }

  enqueueLatest(queueName, taskFn) {
    const prev = this.taskQueues.get(queueName) || Promise.resolve();
    const token = Symbol(queueName);
    this.taskQueues.set(`${queueName}_token`, token);

    const next = prev
      .catch(() => null)
      .then(async () => {
        if (this.taskQueues.get(`${queueName}_token`) !== token) return null;
        return await taskFn(() => this.taskQueues.get(`${queueName}_token`) !== token);
      });

    this.taskQueues.set(queueName, next);
    return next;
  }

  toast(message, duration = 3200) {
    const el = document.getElementById('studio-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.classList.add('hidden');
    }, duration);
  }

  setScanOverlay(visible, text = 'Memproses...', progress = 0) {
    const overlay = document.getElementById('ai-scan-overlay');
    const txt = document.getElementById('scan-status-text');
    const bar = document.getElementById('scan-progress-bar');
    if (!overlay) return;
    if (visible) {
      overlay.classList.remove('hidden');
      if (txt) txt.textContent = text;
      if (bar) bar.style.width = `${Math.max(5, Math.min(100, progress))}%`;
    } else {
      overlay.classList.add('hidden');
    }
  }

  getDeepLinkTool() {
    try {
      const params = new URLSearchParams(window.location.search);
      const map = {
        studio: 'ai-studio',
        pasfoto: 'id-photo',
        kuas: 'retouch',
        produk: 'product',
        kompres: 'optimizer',
        scan: 'scanner',
        sosmed: 'social',
        ocr: 'ocr-collage',
        batch: 'batch'
      };
      const q = (params.get('tool') || '').toLowerCase();
      return map[q] || (Object.values(map).includes(q) ? q : 'ai-studio');
    } catch {
      return 'ai-studio';
    }
  }
}

export const StudioBus = new EventBus();
window.StudioCore = window.StudioCore || {};
window.StudioCore.bus = StudioBus;
window.StudioCore.version = APP_VERSION;

// Global Error Boundary (Mencegah satu galat mematikan tombol lain)
window.addEventListener('error', (e) => {
  console.error('[GlobalErrorGuard]', e.error || e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[UnhandledPromiseGuard]', e.reason);
  if (e.reason && typeof e.reason.message === 'string' && e.reason.message.includes('fetch')) {
    StudioBus.toast('Koneksi jaringan terganggu saat memuat modul. Silakan coba lagi.');
  }
});
