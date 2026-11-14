import { AssetVault } from './media-loader.js';

class BackgroundAndOpticsEngine {
  renderBackground(ctx, w, h, bg) {
    if (!bg || bg.type === 'transparent') return;

    ctx.save();
    if (bg.type === 'color') {
      ctx.fillStyle = bg.color || '#ffffff';
      ctx.fillRect(0, 0, w, h);
    } else if (bg.type === 'gradient') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      const colors = bg.gradient || ['#6366f1', '#06b6d4'];
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, colors[1] || colors[0]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    } else if (bg.type === 'image' && bg.imageId) {
      const asset = AssetVault.getAsset(bg.imageId);
      if (asset && asset.sourceCanvas) {
        if (bg.blur > 0) {
          ctx.filter = `blur(${bg.blur}px)`;
        }
        const scale = Math.max(w / asset.width, h / asset.height);
        const dw = asset.width * scale;
        const dh = asset.height * scale;
        ctx.drawImage(asset.sourceCanvas, (w - dw) / 2, (h - dh) / 2, dw, dh);
      }
    }
    ctx.restore();
  }

  drawCastFloorShadow(ctx, drawW, drawH, intensity) {
    const alpha = Math.min(0.65, (intensity / 100) * 0.6);
    ctx.save();
    const grad = ctx.createRadialGradient(0, drawH * 0.47, 4, 0, drawH * 0.47, drawW * 0.45);
    grad.addColorStop(0, `rgba(0, 0, 0, ${alpha})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, drawH * 0.47, drawW * 0.42, drawH * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawDirectionalRimLight(ctx, subjectCanvas, drawW, drawH, optics) {
    const rad = ((optics.rimLightAngle || 45) * Math.PI) / 180;
    const offsetX = Math.cos(rad) * 10;
    const offsetY = Math.sin(rad) * 10;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = Math.min(0.75, (optics.rimLightIntensity || 0) / 100);
    ctx.shadowColor = optics.rimLightColor || '#38bdf8';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = offsetX;
    ctx.shadowOffsetY = offsetY;
    ctx.drawImage(subjectCanvas, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();
  }

  drawStickerOutline(ctx, maskedCanvas, thickness, color) {
    ctx.save();
    const steps = 12;
    const tintCanvas = document.createElement('canvas');
    tintCanvas.width = maskedCanvas.width;
    tintCanvas.height = maskedCanvas.height;
    const tCtx = tintCanvas.getContext('2d');
    tCtx.drawImage(maskedCanvas, 0, 0);
    tCtx.globalCompositeOperation = 'source-in';
    tCtx.fillStyle = color;
    tCtx.fillRect(0, 0, tintCanvas.width, tintCanvas.height);

    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const dx = Math.cos(angle) * thickness;
      const dy = Math.sin(angle) * thickness;
      ctx.drawImage(tintCanvas, dx, dy);
    }
    ctx.restore();
  }

  drawVignette(ctx, w, h, amount) {
    const alpha = Math.min(0.75, (amount / 100) * 0.7);
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${alpha})`);
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawPasFotoGuide(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);

    // Garis tengah vertikal
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();

    // Oval panduan kepala
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.36, w * 0.21, h * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Garis batas bahu
    ctx.beginPath();
    ctx.moveTo(w * 0.15, h * 0.66);
    ctx.lineTo(w * 0.85, h * 0.66);
    ctx.stroke();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(8, 8, 175, 22);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('Panduan Kepala & Bahu Pas Foto', 14, 22);
    ctx.restore();
  }

  drawSocialSafeZone(ctx, w, h, platform) {
    ctx.save();
    ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
    // Zona tertutup ikon kanan (Like/Comment/Share) & teks caption bawah
    ctx.fillRect(w * 0.82, h * 0.42, w * 0.18, h * 0.45);
    ctx.fillRect(0, h * 0.82, w, h * 0.18);
    ctx.fillRect(0, 0, w, h * 0.08);

    ctx.strokeStyle = '#ef4444';
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(w * 0.05, h * 0.09, w * 0.76, h * 0.72);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`Area Aman ${platform.toUpperCase()} (Jangan taruh teks di area merah)`, 12, h * 0.05);
    ctx.restore();
  }
}

export const BGOptics = new BackgroundAndOpticsEngine();
window.StudioCore.optics = BGOptics;
