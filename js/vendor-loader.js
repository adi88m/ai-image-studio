import { StudioBus } from './core-bus.js';

const loadedScripts = new Map();
const loadedModules = new Map();

const VENDOR_REGISTRY = {
  jszip: [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  ],
  jspdf: [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  ],
  qrcode: [
    'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
    'https://unpkg.com/qrcode@1.5.3/build/qrcode.min.js'
  ],
  heic2any: [
    'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
    'https://unpkg.com/heic2any@0.0.4/dist/heic2any.min.js'
  ],
  tesseract: [
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js',
    'https://unpkg.com/tesseract.js@5.1.0/dist/tesseract.min.js'
  ],
  imglyBg: [
    'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/+esm',
    'https://esm.sh/@imgly/background-removal@1.4.5'
  ]
};

function injectScriptWithTimeout(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      script.remove();
      reject(new Error(`Timeout memuat ${url}`));
    }, timeoutMs);

    script.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };

    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error(`Gagal memuat ${url}`));
    };

    document.head.appendChild(script);
  });
}

export async function loadVendorScript(key) {
  if (loadedScripts.has(key)) return loadedScripts.get(key);

  const urls = VENDOR_REGISTRY[key];
  if (!urls) throw new Error(`Vendor tidak terdaftar: ${key}`);

  const promise = (async () => {
    let lastError = null;
    for (const url of urls) {
      try {
        await injectScriptWithTimeout(url, 8500);
        return true;
      } catch (err) {
        lastError = err;
      }
    }
    loadedScripts.delete(key);
    throw lastError || new Error(`Semua mirror CDN gagal untuk ${key}`);
  })();

  loadedScripts.set(key, promise);
  return promise;
}

export async function loadVendorESModule(key) {
  if (loadedModules.has(key)) return loadedModules.get(key);

  const urls = VENDOR_REGISTRY[key];
  if (!urls) throw new Error(`ES Module tidak terdaftar: ${key}`);

  const promise = (async () => {
    let lastError = null;
    for (const url of urls) {
      try {
        const mod = await Promise.race([
          import(/* @vite-ignore */ url),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ESM Timeout')), 12000))
        ]);
        return mod;
      } catch (err) {
        lastError = err;
      }
    }
    loadedModules.delete(key);
    throw lastError || new Error(`Gagal memuat ES Module ${key}`);
  })();

  loadedModules.set(key, promise);
  return promise;
}

export async function loadToolModule(relativePath) {
  const fullUrl = new URL(relativePath, import.meta.url).href;
  try {
    return await import(/* @vite-ignore */ fullUrl);
  } catch (err) {
    StudioBus.toast('Gagal memuat modul alat. Periksa koneksi internet lalu coba lagi.');
    throw err;
  }
}
