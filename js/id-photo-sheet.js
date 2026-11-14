import { StudioBus } from './core-bus.js';
import { StateStore } from './state-manager.js';
import { RenderEngine } from './render-engine.js';

export const ID_PHOTO_STANDARDS = {
  '2x3': { label: '2x3 cm', w: 600, h: 900, aspect: '2:3' },
  '3x4': { label: '3x4 cm', w: 900, h: 1200, aspect: '3:4' },
  '4x6': { label: '4x6 cm', w: 1200, h: 1800, aspect: '2:3' },
  visa: { label: 'Paspor/Visa 5x5', w: 1200, h: 1200, aspect: '1:1' }
};

export function setIDPhotoStandard(sizeKey = '3x4', bgHex = '#db1514') {
  const std = ID_PHOTO_STANDARDS[sizeKey] || ID_PHOTO_STANDARDS['3x4'];
  StateStore.state.canvas = {
    width: std.w,
    height: std.h,
    aspectLabel: std.aspect,
    safeZone: 'pasfoto'
  };
  StateStore.state.background.type = 'color';
  StateStore.state.background.color = bgHex;

  // Smart Face-Centered Framing otomatis (Browser FaceDetector API jika tersedia + fallback simetris)
  autoCenterFaceFrame();

  StateStore.snapshot();
  StudioBus.emit('STATE_RESTORED', StateStore.state);
  StudioBus.toast(`Pas Foto ${std.label} siap!`);
}

export async function autoCenterFaceFrame() {
  const sel = StateStore.getSelectedLayer();
  if (!sel || sel.type !== 'subject') return;

  try {
    if ('FaceDetector' in window && RenderEngine.mainCanvas) {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await detector.detect(RenderEngine.mainCanvas);
      if (faces && faces.length > 0) {
        const box = faces[0].boundingBox;
        const cw = RenderEngine.mainCanvas.width;
        const ch = RenderEngine.mainCanvas.height;
        const faceCenterX = (box.x + box.width / 2) / cw;
        const faceCenterY = (box.y + box.height / 2) / ch;
        sel.x = Math.max(0.2, Math.min(0.8, sel.x + (0.5 - faceCenterX)));
        sel.y = Math.max(0.2, Math.min(0.85, sel.y + (0.36 - faceCenterY)));
        RenderEngine.requestRender();
        return;
      }
    }
  } catch {
    // Gunakan penempatan proporsional standar
  }
  sel.x = 0.5;
  sel.y = 0.56;
  RenderEngine.requestRender();
}

export function generatePrintSheetCanvas(paperType = '4R', sizeKey = '3x4') {
  // 300 DPI: 4R = 1200 x 1800 px | A4 = 2480 x 3508 px
  const sheetW = paperType === 'A4' ? 2480 : 1200;
  const sheetH = paperType === 'A4' ? 3508 : 1800;

  const singlePhoto = RenderEngine.renderHighResExport(1.5);
  const sheet = document.createElement('canvas');
  sheet.width = sheetW;
  sheet.height = sheetH;
  const ctx = sheet.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sheetW, sheetH);

  // Ukuran cetak piksel 300 DPI (1 cm = 118.11 px)
  const cmToPx = 118.11;
  const dims = {
    '2x3': { w: Math.round(2 * cmToPx), h: Math.round(3 * cmToPx) },
    '3x4': { w: Math.round(3 * cmToPx), h: Math.round(4 * cmToPx) },
    '4x6': { w: Math.round(4 * cmToPx), h: Math.round(6 * cmToPx) },
    visa: { w: Math.round(5 * cmToPx), h: Math.round(5 * cmToPx) }
  };
  const item = dims[sizeKey] || dims['3x4'];
  const gap = 36;
  const margin = 60;

  const cols = Math.floor((sheetW - margin * 2 + gap) / (item.w + gap));
  const rows = Math.floor((sheetH - margin * 2 + gap) / (item.h + gap));

  const totalGridW = cols * item.w + (cols - 1) * gap;
  const totalGridH = rows * item.h + (rows - 1) * gap;
  const startX = Math.round((sheetW - totalGridW) / 2);
  const startY = Math.round((sheetH - totalGridH) / 2);

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = startX + c * (item.w + gap);
      const py = startY + r * (item.h + gap);
      ctx.drawImage(singlePhoto, px, py, item.w, item.h);
      // Garis panduan gunting (Crop Marks)
      ctx.strokeRect(px - 2, py - 2, item.w + 4, item.h + 4);
    }
  }

  return { canvas: sheet, count: cols * rows };
}
