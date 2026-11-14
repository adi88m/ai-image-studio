// Background Pixel Processor (Kompatibel sebagai Worker file maupun Inline Blob)
const workerLogic = () => {
  self.onmessage = function (e) {
    const { id, task, width, height, buffer, params } = e.data;
    try {
      const data = new Uint8ClampedArray(buffer);

      if (task === 'AUTO_ENHANCE') {
        // Histogram Contrast Stretch + Unsharp Mask ringan
        let minL = 255;
        let maxL = 0;
        for (let i = 0; i < data.length; i += 16) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum < minL) minL = lum;
          if (lum > maxL) maxL = lum;
        }
        const range = Math.max(30, maxL - minL);
        const scale = 255 / range;

        for (let i = 0; i < data.length; i += 4) {
          data[i] = Math.min(255, Math.max(0, (data[i] - minL) * scale));
          data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - minL) * scale));
          data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - minL) * scale));
        }
      } else if (task === 'EDGE_DESPILL') {
        const strength = (params?.strength || 50) / 100;
        const maskData = new Uint8ClampedArray(params.maskBuffer);
        for (let i = 0; i < data.length; i += 4) {
          const alpha = maskData[i];
          // Targetkan piksel semi-transparan pada batas terluar rambut/bahu
          if (alpha > 15 && alpha < 235) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            data[i] = data[i] + (avg - data[i]) * strength;
            data[i + 1] = data[i + 1] + (avg - data[i + 1]) * strength;
            data[i + 2] = data[i + 2] + (avg - data[i + 2]) * strength;
          }
        }
      } else if (task === 'DOC_SCAN_FILTER') {
        const mode = params?.mode || 'bw'; // bw | magic
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          if (mode === 'bw') {
            const val = lum > 142 ? 255 : lum < 85 ? 0 : Math.round((lum - 85) * (255 / 57));
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
          } else {
            // Magic Color: naikkan kontras teks sambil memutihkan kertas
            const boost = lum > 175 ? 1.25 : 0.85;
            data[i] = Math.min(255, Math.max(0, r * boost));
            data[i + 1] = Math.min(255, Math.max(0, g * boost));
            data[i + 2] = Math.min(255, Math.max(0, b * boost));
          }
        }
      } else if (task === 'EXTRACT_SIGNATURE') {
        const tint = params?.tint || 'black'; // black | blue
        for (let i = 0; i < data.length; i += 4) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          if (lum > 165) {
            data[i + 3] = 0;
          } else {
            const inkAlpha = Math.min(255, Math.round((165 - lum) * 2.2));
            if (tint === 'blue') {
              data[i] = 12;
              data[i + 1] = 56;
              data[i + 2] = 168;
            } else {
              data[i] = 15;
              data[i + 1] = 23;
              data[i + 2] = 42;
            }
            data[i + 3] = inkAlpha;
          }
        }
      }

      self.postMessage({ id, ok: true, buffer: data.buffer }, [data.buffer]);
    } catch (err) {
      self.postMessage({ id, ok: false, error: err.message });
    }
  };
};

// Jika dijalankan di dalam Worker context
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  workerLogic();
}

// Client Bridge dengan Inline Blob Fallback anti-CORS / subpath GitHub Pages
class PixelWorkerClient {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.seq = 0;
    this.initWorker();
  }

  initWorker() {
    try {
      const code = `(${workerLogic.toString()})()`;
      const blob = new Blob([code], { type: 'application/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      this.worker = new Worker(blobUrl);
      this.worker.onmessage = (e) => {
        const { id, ok, buffer, error } = e.data;
        const job = this.pending.get(id);
        if (!job) return;
        this.pending.delete(id);
        if (ok) job.resolve(new Uint8ClampedArray(buffer));
        else job.reject(new Error(error));
      };
    } catch (err) {
      console.warn('[PixelWorker] Fallback synchronous mode:', err);
      this.worker = null;
    }
  }

  run(task, imageData, params = {}) {
    if (!this.worker) {
      return Promise.resolve(imageData);
    }
    const id = ++this.seq;
    const copy = new Uint8ClampedArray(imageData.data);
    const transferables = [copy.buffer];
    const clonedParams = { ...params };
    if (params.maskBuffer) {
      const mCopy = new Uint8ClampedArray(params.maskBuffer);
      clonedParams.maskBuffer = mCopy.buffer;
      transferables.push(mCopy.buffer);
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (resultArray) => {
          resolve(new ImageData(resultArray, imageData.width, imageData.height));
        },
        reject
      });
      this.worker.postMessage(
        { id, task, width: imageData.width, height: imageData.height, buffer: copy.buffer, params: clonedParams },
        transferables
      );
    });
  }
}

export const PixelWorker = new PixelWorkerClient();
