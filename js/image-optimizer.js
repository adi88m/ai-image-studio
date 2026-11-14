import { StudioBus } from './core-bus.js';
import { RenderEngine } from './render-engine.js';
import { normalizeImageFile } from './media-loader.js';
import { loadVendorScript } from './vendor-loader.js';

export async function compressToTargetKB(targetKB = 200, mimeType = 'image/jpeg') {
  const source = RenderEngine.renderHighResExport(2);
  if (!source || source.width < 10) {
    throw new Error('Kanvas masih kosong.');
  }

  // Untuk JPG, pastikan latar belakang transparan diisi putih agar tidak menjadi hitam
  const workCanvas = document.createElement('canvas');
  workCanvas.width = source.width;
  workCanvas.height = source.height;
  const wCtx = workCanvas.getContext('2d');
  if (mimeType === 'image/jpeg') {
    wCtx.fillStyle = '#ffffff';
    wCtx.fillRect(0, 0, workCanvas.width, workCanvas.height);
  }
  wCtx.drawImage(source, 0, 0);

  const targetBytes = Math.max(15, targetKB) * 1024;
  let minQ = 0.08;
  let maxQ = 0.96;
  let bestBlob = null;

  // Binary search 7 iterasi untuk mendapatkan ukuran byte paling mendekati target KB
  for (let i = 0; i < 7; i++) {
    const midQ = (minQ + maxQ) / 2;
    const blob = await new Promise((res) => workCanvas.toBlob(res, mimeType, midQ));
    if (!blob) break;
    bestBlob = blob;

    if (blob.size > targetBytes) {
      maxQ = midQ;
    } else {
      minQ = midQ;
    }
  }

  // Jika pada kualitas terendah ukuran masih di atas targetKB, perkecil dimensi secara bertahap
  let scaleStep = 0.85;
  while (bestBlob && bestBlob.size > targetBytes && scaleStep >= 0.35) {
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(workCanvas.width * scaleStep);
    scaled.height = Math.round(workCanvas.height * scaleStep);
    scaled.getContext('2d').drawImage(workCanvas, 0, 0, scaled.width, scaled.height);
    bestBlob = await new Promise((res) => scaled.toBlob(res, mimeType, 0.55));
    scaleStep -= 0.15;
  }

  return {
    blob: bestBlob,
    finalKB: bestBlob ? (bestBlob.size / 1024).toFixed(1) : '0'
  };
}

export async function exportImagesToPDF(fileList = null) {
  StudioBus.setScanOverlay(true, 'Menyusun dokumen PDF...', 40);
  try {
    await loadVendorScript('jspdf');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const canvases = [];
    if (fileList && fileList.length > 0) {
      for (const f of [...fileList].slice(0, 12)) {
        const norm = await normalizeImageFile(f, 1600);
        canvases.push(norm.sourceCanvas);
      }
    } else {
      canvases.push(RenderEngine.renderHighResExport(2));
    }

    canvases.forEach((cv, idx) => {
      if (idx > 0) pdf.addPage();
      const margin = 10;
      const maxW = pageW - margin * 2;
      const maxH = pageH - margin * 2;
      const ratio = Math.min(maxW / cv.width, maxH / cv.height);
      const dw = cv.width * ratio;
      const dh = cv.height * ratio;
      const x = (pageW - dw) / 2;
      const y = (pageH - dh) / 2;

      const dataUrl = cv.toDataURL('image/jpeg', 0.9);
      pdf.addImage(dataUrl, 'JPEG', x, y, dw, dh);
    });

    const pdfBlob = pdf.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dokumen_adi88m_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    StudioBus.toast(`Dokumen PDF (${canvases.length} halaman) berhasil diunduh!`);
  } finally {
    StudioBus.setScanOverlay(false);
  }
}

export async function stripExifAndDownloadClean(mimeType = 'image/jpeg') {
  // Menggambar ulang ke HTML5 Canvas otomatis menghapus seluruh metadata EXIF, GPS, dan serial kamera
  const cleanCanvas = RenderEngine.renderHighResExport(2);
  const out = document.createElement('canvas');
  out.width = cleanCanvas.width;
  out.height = cleanCanvas.height;
  const ctx = out.getContext('2d');
  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(cleanCanvas, 0, 0);

  const blob = await new Promise((res) => out.toBlob(res, mimeType, 0.94));
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `foto_bersih_tanpa_exif_${Date.now()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  StudioBus.toast('Metadata EXIF & lokasi GPS berhasil dihapus total!');
}
