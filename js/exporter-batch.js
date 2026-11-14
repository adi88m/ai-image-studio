import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { RenderEngine } from './render-engine.js';
import { normalizeImageFile } from './media-loader.js';
import { loadVendorScript } from './vendor-loader.js';

class MultiFormatExporter {
  constructor() {
    this.lastExportBlob = null;
    this.lastExportName = 'adi88m_studio.png';
    this.lastPreviewUrl = null;
  }

  init() {
    const btnOpen = document.getElementById('btn-export-primary');
    const btnClose = document.getElementById('btn-close-export');
    const selFormat = document.getElementById('export-format');
    const selScale = document.getElementById('export-scale');
    const btnDownload = document.getElementById('btn-trigger-download');
    const btnShare = document.getElementById('btn-trigger-share');

    if (btnOpen) btnOpen.addEventListener('click', () => this.openExportModal());
    if (btnClose) btnClose.addEventListener('click', () => this.closeExportModal());
    if (selFormat) selFormat.addEventListener('change', () => this.refreshPreview());
    if (selScale) selScale.addEventListener('change', () => this.refreshPreview());

    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (!this.lastExportBlob) return;
        this.downloadBlob(this.lastExportBlob, this.lastExportName);
        StudioBus.toast('File berhasil diunduh ke perangkat!');
      });
    }

    if (btnShare) {
      btnShare.addEventListener('click', () => this.shareToMobileOS());
    }
  }

  async openExportModal() {
    if (StateStore.state.layers.length === 0) {
      StudioBus.toast('Unggah atau pilih foto sampel terlebih dahulu.');
      return;
    }
    const modal = document.getElementById('export-modal');
    if (modal) modal.classList.remove('hidden');
    await this.refreshPreview();
  }

  closeExportModal() {
    const modal = document.getElementById('export-modal');
    if (modal) modal.classList.add('hidden');
    if (this.lastPreviewUrl) {
      URL.revokeObjectURL(this.lastPreviewUrl);
      this.lastPreviewUrl = null;
    }
  }

  async refreshPreview() {
    const formatEl = document.getElementById('export-format');
    const scaleEl = document.getElementById('export-scale');
    const imgEl = document.getElementById('export-preview-img');
    const metaEl = document.getElementById('export-meta-info');

    const mime = formatEl ? formatEl.value : 'image/png';
    const scale = scaleEl ? Number(scaleEl.value) : 2;
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';

    const highResCanvas = RenderEngine.renderHighResExport(scale);

    // Jika JPG, pastikan latar belakang transparan terisi putih bersih
    let finalCanvas = highResCanvas;
    if (mime === 'image/jpeg') {
      finalCanvas = document.createElement('canvas');
      finalCanvas.width = highResCanvas.width;
      finalCanvas.height = highResCanvas.height;
      const ctx = finalCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
      ctx.drawImage(highResCanvas, 0, 0);
    }

    const blob = await new Promise((res) => finalCanvas.toBlob(res, mime, 0.94));
    if (!blob) return;

    this.lastExportBlob = blob;
    this.lastExportName = `adi88m_studio_${finalCanvas.width}x${finalCanvas.height}.${ext}`;

    if (this.lastPreviewUrl) URL.revokeObjectURL(this.lastPreviewUrl);
    this.lastPreviewUrl = URL.createObjectURL(blob);

    if (imgEl) imgEl.src = this.lastPreviewUrl;
    if (metaEl) {
      const kb = (blob.size / 1024).toFixed(1);
      metaEl.textContent = `${ext.toUpperCase()} • ${finalCanvas.width}x${finalCanvas.height}px • ${kb} KB`;
    }
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 12000);
  }

  async shareToMobileOS() {
    if (!this.lastExportBlob) return;
    try {
      const file = new File([this.lastExportBlob], this.lastExportName, { type: this.lastExportBlob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Hasil Edit AI Image Studio — adi88m'
        });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    this.downloadBlob(this.lastExportBlob, this.lastExportName);
    StudioBus.toast('Perangkat tidak mendukung Share Sheet langsung, file dialihkan ke Unduhan.');
  }

  // Batch Multi-Image Processor -> ZIP (Kompres + Resize + Watermark massal)
  async processBatchToZip(fileList, options = {}) {
    const files = [...(fileList || [])].slice(0, 25);
    if (files.length === 0) {
      StudioBus.toast('Pilih minimal 1 hingga 25 gambar untuk diproses massal.');
      return;
    }

    const maxWidth = Number(options.maxWidth) || 1280;
    const format = options.format || 'image/jpeg';
    const quality = Number(options.quality) || 0.85;
    const watermark = (options.watermark || '').trim();
    const ext = format === 'image/webp' ? 'webp' : format === 'image/png' ? 'png' : 'jpg';

    return StudioBus.withLock('batch_zip', async () => {
      StudioBus.setScanOverlay(true, 'Menyiapkan pengemas arsip ZIP...', 10);
      try {
        await loadVendorScript('jszip');
        const zip = new window.JSZip();

        for (let i = 0; i < files.length; i++) {
          const pct = Math.round(((i + 1) / files.length) * 85) + 10;
          StudioBus.setScanOverlay(true, `Memproses foto ${i + 1} dari ${files.length}...`, pct);

          const norm = await normalizeImageFile(files[i], maxWidth);
          const canvas = norm.sourceCanvas;

          if (watermark) {
            const ctx = canvas.getContext('2d');
            const fSize = Math.max(16, Math.round(canvas.width / 28));
            ctx.save();
            ctx.font = `700 ${fSize}px "Plus Jakarta Sans", sans-serif`;
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.strokeStyle = 'rgba(15,23,42,0.65)';
            ctx.lineWidth = 3;
            ctx.textAlign = 'right';
            ctx.strokeText(watermark, canvas.width - 20, canvas.height - 20);
            ctx.fillText(watermark, canvas.width - 20, canvas.height - 20);
            ctx.restore();
          }

          const blob = await new Promise((res) => canvas.toBlob(res, format, quality));
          const cleanBase = (files[i].name || `gambar_${i + 1}`).replace(/\.[^/.]+$/, '');
          zip.file(`${cleanBase}_adi88m.${ext}`, blob);

          // Bebaskan segera memori per iterasi agar HP RAM 3GB-4GB aman
          norm.sourceCanvas.width = 0;
          norm.maskCanvas.width = 0;
          await new Promise((r) => setTimeout(r, 15));
        }

        StudioBus.setScanOverlay(true, 'Mengompres file ZIP akhir...', 98);
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        this.downloadBlob(zipBlob, `adi88m_batch_${files.length}_foto.zip`);
        StudioBus.toast(`Selesai! ${files.length} foto berhasil dikemas dalam ZIP.`);
      } finally {
        StudioBus.setScanOverlay(false);
      }
    });
  }
}

export const ExporterBatch = new MultiFormatExporter();
window.StudioCore.exporter = ExporterBatch;
