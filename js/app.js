import { StudioBus, APP_VERSION } from './core-bus.js';
import { StateStore, clamp } from './state-manager.js';
import { AssetVault, normalizeImageFile, generateDemoSampleAsset } from './media-loader.js';
import { AISegmenter } from './ai-segmenter.js';
import { ColorEngine, LUT_PRESETS } from './color-engine.js';
import { RenderEngine } from './render-engine.js';
import { LayerCompositor } from './layer-compositor.js';
import { BrushTools } from './brush-tools.js';
import { applyCompositionPreset, generateTiledWatermarkCanvas } from './template-presets.js';
import { setIDPhotoStandard, generatePrintSheetCanvas } from './id-photo-sheet.js';
import { applyDocumentScanFilter, extractTransparentSignature, straightenDocumentPerspective } from './doc-scanner.js';
import { splitInstagramGridAndZip, exportWhatsAppSticker512, generateQRCodeLayer } from './social-generators.js';
import { extractTextFromActiveCanvas, buildAutoCollageFromFiles } from './ocr-collage.js';
import { compressToTargetKB, exportImagesToPDF, stripExifAndDownloadClean } from './image-optimizer.js';
import { ExporterBatch } from './exporter-batch.js';

class StudioAppCoordinator {
  constructor() {
    this.activeSubTool = null;
    this.resizeTimer = null;
  }

  init() {
    this.registerServiceWorker();
    this.setupEnvironmentGuards();

    RenderEngine.init();
    LayerCompositor.init();
    BrushTools.init();
    ExporterBatch.init();

    this.bindHeaderAndStageEvents();
    this.bindHubNavigation();

    // Deep-Link Routing (?tool=pasfoto, ?tool=kompres, dll)
    const initialHub = StudioBus.getDeepLinkTool();
    this.switchHub(initialHub);

    // Daftarkan pelapor tinggi otomatis ke parent Blogger iframe
    this.setupIframeAutoHeight();
    RenderEngine.requestRender();
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator && !StudioBus.env.isInAppWebView) {
      navigator.serviceWorker.register('./sw.js').catch(() => null);
    }
  }

  setupEnvironmentGuards() {
    if (StudioBus.env.isInAppWebView) {
      const banner = document.getElementById('webview-banner');
      if (banner) banner.classList.remove('hidden');
      const btnPop = document.getElementById('btn-popout-browser');
      if (btnPop) {
        btnPop.addEventListener('click', () => {
          window.open(window.location.href, '_blank', 'noopener');
        });
      }
    }
  }

  setupIframeAutoHeight() {
    if (!StudioBus.env.isInIframe) return;

    const notifyParentHeight = () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        const shell = document.getElementById('studio-app');
        if (!shell) return;
        const height = Math.min(2200, Math.max(640, Math.ceil(shell.getBoundingClientRect().height)));
        try {
          window.parent.postMessage({ type: 'ADI88M_STUDIO_RESIZE', height }, '*');
        } catch {}
      }, 160);
    };

    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(notifyParentHeight);
      const shell = document.getElementById('studio-app');
      if (shell) ro.observe(shell);
    }
    window.addEventListener('resize', notifyParentHeight);
    notifyParentHeight();
  }

  bindHeaderAndStageEvents() {
    document.getElementById('btn-undo')?.addEventListener('click', () => StateStore.undo());
    document.getElementById('btn-redo')?.addEventListener('click', () => StateStore.redo());

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) StateStore.redo();
        else StateStore.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        StateStore.redo();
      }
    });

    // Split Compare Before/After
    document.getElementById('btn-split-compare')?.addEventListener('click', () => {
      const splitUI = document.getElementById('split-slider-ui');
      const isSplit = StateStore.state.activeToolMode === 'SPLIT_VIEW';
      StateStore.state.activeToolMode = isSplit ? 'TRANSFORM' : 'SPLIT_VIEW';
      if (splitUI) splitUI.classList.toggle('hidden', isSplit);
      RenderEngine.requestRender();
    });

    // Canvas Touch-Lock (Agar pengunjung Blogger mudah menggulir artikel)
    const btnLock = document.getElementById('btn-touch-lock');
    btnLock?.addEventListener('click', () => {
      StateStore.state.touchLocked = !StateStore.state.touchLocked;
      btnLock.classList.toggle('locked', StateStore.state.touchLocked);
      StudioBus.toast(
        StateStore.state.touchLocked
          ? 'Kanvas dikunci — Anda bisa menggulir halaman blog dengan bebas.'
          : 'Kanvas dibuka kembali untuk mengedit.'
      );
    });

    // Theme Toggle (Dark/Light)
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      StateStore.saveThemePreference(next);
    });

    // Fullscreen / Popout
    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (StudioBus.env.isInIframe) {
        window.open(window.location.href, '_blank', 'noopener');
        return;
      }
      const shell = document.getElementById('studio-app');
      if (!document.fullscreenElement && shell?.requestFullscreen) {
        shell.requestFullscreen().catch(() => null);
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => null);
      }
    });

    // Upload Primary & Camera & Add Layer
    const handleFileUpload = async (file, asAdditionalLayer = false) => {
      if (!file) return;
      try {
        StudioBus.setScanOverlay(true, 'Memuat & mengoptimalkan resolusi foto...', 30);
        const asset = await normalizeImageFile(file);
        const mediaKey = `media_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        AssetVault.setAsset(mediaKey, asset);

        if (!asAdditionalLayer || StateStore.state.layers.length === 0) {
          StateStore.state.canvas.width = asset.width;
          StateStore.state.canvas.height = asset.height;
          StateStore.state.layers = [];
        }

        const idx = StateStore.state.layers.filter((l) => l.type === 'subject').length + 1;
        const layer = StateStore.createLayerObject({
          type: 'subject',
          name: `Subjek ${idx}`,
          x: idx === 1 ? 0.5 : 0.62,
          y: 0.5,
          scale: idx === 1 ? 0.92 : 0.72,
          mediaKey
        });

        StateStore.state.layers.push(layer);
        StateStore.state.selectedLayerId = layer.id;
        StateStore.state.activeToolMode = 'TRANSFORM';

        document.getElementById('empty-onboarding')?.classList.add('hidden');
        this.updateLayerCounter();
        StateStore.snapshot();
        RenderEngine.requestRender();
        StudioBus.toast(`Foto dimuat (${asset.width}x${asset.height}px)`);
      } catch (err) {
        StudioBus.toast(err.message || 'Gagal membaca file gambar.');
      } finally {
        StudioBus.setScanOverlay(false);
      }
    };

    document.getElementById('file-input-primary')?.addEventListener('change', (e) => {
      handleFileUpload(e.target.files?.[0], false);
      e.target.value = '';
    });
    document.getElementById('file-input-camera')?.addEventListener('change', (e) => {
      handleFileUpload(e.target.files?.[0], false);
      e.target.value = '';
    });
    document.getElementById('file-input-add-layer')?.addEventListener('change', (e) => {
      handleFileUpload(e.target.files?.[0], true);
      e.target.value = '';
    });

    // Drag & Drop Zone
    const dropzone = document.getElementById('canvas-stage');
    if (dropzone) {
      dropzone.addEventListener('dragover', (e) => e.preventDefault());
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFileUpload(file, StateStore.state.layers.length > 0);
      });
    }

    // 1-Click Sample Gallery
    document.querySelectorAll('.sample-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kind = btn.dataset.sample || 'portrait';
        const demo = generateDemoSampleAsset(kind);
        const mediaKey = `sample_${Date.now()}`;
        AssetVault.setAsset(mediaKey, demo);

        StateStore.state.canvas = { width: demo.width, height: demo.height, aspectLabel: '4:5', safeZone: 'none' };
        const layer = StateStore.createLayerObject({
          type: 'subject',
          name: 'Sampel Subjek 1',
          x: kind === 'couple' ? 0.35 : 0.5,
          y: 0.52,
          scale: kind === 'couple' ? 0.72 : 0.88,
          mediaKey
        });
        StateStore.state.layers = [layer];

        if (kind === 'couple') {
          const demo2 = generateDemoSampleAsset('portrait');
          const key2 = `sample2_${Date.now()}`;
          AssetVault.setAsset(key2, demo2);
          StateStore.state.layers.push(
            StateStore.createLayerObject({
              type: 'subject',
              name: 'Sampel Subjek 2',
              x: 0.65,
              y: 0.52,
              scale: 0.72,
              mediaKey: key2
            })
          );
        }

        StateStore.state.selectedLayerId = layer.id;
        document.getElementById('empty-onboarding')?.classList.add('hidden');
        this.updateLayerCounter();
        StateStore.snapshot();
        RenderEngine.requestRender();
        StudioBus.toast('Foto sampel dimuat! Coba klik "Hapus BG AI" atau "Magic Wand".');
      });
    });

    // Layers Drawer
    document.getElementById('btn-layers-drawer')?.addEventListener('click', () => {
      this.renderLayersList();
      document.getElementById('layers-modal')?.classList.remove('hidden');
    });
    document.getElementById('btn-close-layers')?.addEventListener('click', () => {
      document.getElementById('layers-modal')?.classList.add('hidden');
    });
    document.getElementById('btn-add-text-layer')?.addEventListener('click', () => {
      const txt = prompt('Masukkan teks yang ingin ditambahkan:', 'PROMO SPESIAL');
      if (txt) {
        LayerCompositor.addTextLayer(txt);
        this.renderLayersList();
        this.updateLayerCounter();
      }
    });
    document.getElementById('btn-add-shape-layer')?.addEventListener('click', () => {
      LayerCompositor.addShapeLayer('arrow');
      this.renderLayersList();
      this.updateLayerCounter();
    });

    StudioBus.on('LAYERS_LIST_CHANGED', () => {
      this.updateLayerCounter();
      this.renderLayersList();
    });

    // Clear Cache
    document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      StudioBus.toast('Cache aplikasi dibersihkan. Muat ulang halaman untuk versi terbaru.');
    });
  }

  updateLayerCounter() {
    const el = document.getElementById('layer-count');
    if (el) el.textContent = String(StateStore.state.layers.length);
  }

  renderLayersList() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';

    [...StateStore.state.layers].reverse().forEach((layer) => {
      const row = document.createElement('div');
      row.className = 'control-row';
      row.style.padding = '8px';
      row.style.borderRadius = '8px';
      row.style.background = layer.id === StateStore.state.selectedLayerId ? 'rgba(99,102,241,0.22)' : 'var(--bg-elevated)';

      const title = document.createElement('span');
      title.textContent = `${layer.visible ? '👁️' : '🚫'} ${layer.name}`;
      title.style.cursor = 'pointer';
      title.style.fontWeight = '600';
      title.onclick = () => {
        StateStore.state.selectedLayerId = layer.id;
        this.renderLayersList();
        RenderEngine.requestRender();
      };

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '4px';

      const btnVis = document.createElement('button');
      btnVis.className = 'btn-xs';
      btnVis.textContent = layer.visible ? 'Sembunyi' : 'Tampil';
      btnVis.onclick = () => {
        layer.visible = !layer.visible;
        RenderEngine.requestRender();
        this.renderLayersList();
      };

      const btnDel = document.createElement('button');
      btnDel.className = 'btn-xs';
      btnDel.style.background = '#ef4444';
      btnDel.style.color = '#fff';
      btnDel.textContent = 'Hapus';
      btnDel.onclick = () => {
        if (layer.mediaKey) AssetVault.disposeAsset(layer.mediaKey);
        StateStore.state.layers = StateStore.state.layers.filter((l) => l.id !== layer.id);
        this.updateLayerCounter();
        this.renderLayersList();
        RenderEngine.requestRender();
      };

      actions.append(btnVis, btnDel);
      row.append(title, actions);
      list.appendChild(row);
    });
  }

  bindHubNavigation() {
    document.querySelectorAll('.hub-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        const hub = tab.dataset.hub;
        if (hub) this.switchHub(hub);
      });
    });
  }

  switchHub(hubKey) {
    StateStore.state.activeHub = hubKey;
    StateStore.state.activeToolMode = 'TRANSFORM';
    document.querySelectorAll('.hub-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.hub === hubKey);
    });

    const strip = document.getElementById('sub-action-strip');
    const drawer = document.getElementById('active-control-drawer');
    if (!strip || !drawer) return;

    const hubConfigs = {
      'ai-studio': [
        { id: 'ai_rmbg', icon: '✨', label: 'Hapus BG AI', action: () => AISegmenter.runAISegmentation() },
        { id: 'magic_wand', icon: '🪄', label: 'Magic Wand', action: () => AISegmenter.runMagicWandFloodFill() },
        { id: 'bg_color', icon: '🎨', label: 'Ganti Latar', panel: () => this.renderBgColorPanel(drawer) },
        { id: 'auto_match', icon: '🌗', label: 'Match Warna', action: () => ColorEngine.autoMatchColorWithBackground() },
        { id: 'enhance_hd', icon: '💎', label: 'Enhance HD', action: () => ColorEngine.autoEnhanceLayer() },
        { id: 'lut_filter', icon: '🎞️', label: 'Filter LUT', panel: () => this.renderLutPanel(drawer) },
        { id: 'presets', icon: '⚡', label: 'Template', panel: () => this.renderPresetsPanel(drawer) }
      ],
      'id-photo': [
        { id: 'pf_merah', icon: '🟥', label: 'Merah 3x4', action: () => setIDPhotoStandard('3x4', '#db1514') },
        { id: 'pf_biru', icon: '🟦', label: 'Biru 3x4', action: () => setIDPhotoStandard('3x4', '#0055b8') },
        { id: 'pf_4x6', icon: '🪪', label: 'Ukuran 4x6', action: () => setIDPhotoStandard('4x6', StateStore.state.background.color || '#db1514') },
        { id: 'pf_2x3', icon: '🖼️', label: 'Ukuran 2x3', action: () => setIDPhotoStandard('2x3', StateStore.state.background.color || '#db1514') },
        { id: 'sheet_4r', icon: '🖨️', label: 'Cetak 4R', action: () => this.handlePrintSheet('4R') },
        { id: 'sheet_a4', icon: '📄', label: 'Cetak A4', action: () => this.handlePrintSheet('A4') }
      ],
      retouch: [
        { id: 'brush_erase', icon: '🧽', label: 'Kuas Hapus', panel: () => this.renderBrushPanel(drawer, 'BRUSH_ERASE') },
        { id: 'brush_restore', icon: '🖌️', label: 'Kuas Pulih', panel: () => this.renderBrushPanel(drawer, 'BRUSH_RESTORE') },
        { id: 'lasso_cut', icon: '✂️', label: 'Lasso Manual', panel: () => this.activateLassoMode(drawer) },
        { id: 'blemish', icon: '🩹', label: 'Hapus Noda', panel: () => this.renderBrushPanel(drawer, 'BLEMISH') },
        { id: 'sensor_blur', icon: '🕶️', label: 'Sensor Privasi', panel: () => this.renderBrushPanel(drawer, 'SENSOR') },
        { id: 'mask_reset', icon: '🔄', label: 'Reset Masker', action: () => AISegmenter.resetMask() }
      ],
      product: [
        { id: 'prod_tpl', icon: '🛍️', label: 'Studio Putih', action: () => applyCompositionPreset('produk_umkm') },
        { id: 'shadow_ctrl', icon: '🌑', label: 'Bayangan', panel: () => this.renderOpticsPanel(drawer) },
        { id: 'add_badge', icon: '🏷️', label: 'Label Diskon', action: () => LayerCompositor.addTextLayer('DISKON 50% • GRATIS ONGKIR') },
        { id: 'watermark_tile', icon: '🛡️', label: 'Watermark Anti-Curi', panel: () => this.renderWatermarkPanel(drawer) }
      ],
      optimizer: [
        { id: 'kb_comp', icon: '📉', label: 'Kompres KB', panel: () => this.renderTargetKBPanel(drawer) },
        { id: 'to_pdf', icon: '📑', label: 'Gambar ke PDF', panel: () => this.renderPdfPanel(drawer) },
        { id: 'strip_exif', icon: '🔒', label: 'Hapus EXIF/GPS', action: () => stripExifAndDownloadClean('image/jpeg') }
      ],
      scanner: [
        { id: 'scan_bw', icon: '📃', label: 'Scan B&W Tajam', action: () => applyDocumentScanFilter('bw') },
        { id: 'scan_magic', icon: '🌈', label: 'Magic Color', action: () => applyDocumentScanFilter('magic') },
        { id: 'scan_crop', icon: '📐', label: 'Rapikan Tepi', action: () => straightenDocumentPerspective(0.05) },
        { id: 'sig_black', icon: '✒️', label: 'TTD Hitam PNG', action: () => extractTransparentSignature('black') },
        { id: 'sig_blue', icon: '🖊️', label: 'TTD Biru PNG', action: () => extractTransparentSignature('blue') }
      ],
      social: [
        { id: 'ig_3x3', icon: ' grid', label: 'IG Grid 3x3', action: () => splitInstagramGridAndZip(3, 3) },
        { id: 'ig_3x1', icon: '🎞️', label: 'Carousel 3x1', action: () => splitInstagramGridAndZip(1, 3) },
        { id: 'wa_stiker', icon: '💬', label: 'Stiker WA 512', action: () => exportWhatsAppSticker512() },
        { id: 'qr_gen', icon: '📲', label: 'Buat QR Code', panel: () => this.renderQRPanel(drawer) }
      ],
      'ocr-collage': [
        { id: 'ocr_read', icon: '🔤', label: 'Salin Teks OCR', panel: () => this.renderOCRPanel(drawer) },
        { id: 'collage_mk', icon: '🖼️', label: 'Buat Kolase', panel: () => this.renderCollagePanel(drawer) }
      ],
      batch: [
        { id: 'batch_zip', icon: '📦', label: 'Batch Proses ZIP', panel: () => this.renderBatchZipPanel(drawer) }
      ]
    };

    const tools = hubConfigs[hubKey] || hubConfigs['ai-studio'];
    strip.innerHTML = '';

    tools.forEach((tool, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sub-tool-btn';
      btn.innerHTML = `<span style="font-size:17px">${tool.icon === ' grid' ? '▦' : tool.icon}</span><span>${tool.label}</span>`;
      btn.addEventListener('click', () => {
        strip.querySelectorAll('.sub-tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (tool.panel) tool.panel();
        else if (tool.action) tool.action();
      });
      strip.appendChild(btn);

      if (idx === 0 && tool.panel) {
        btn.classList.add('active');
        tool.panel();
      }
    });

    if (!tools[0]?.panel) {
      drawer.innerHTML = `<div class="drawer-placeholder">Pilih salah satu alat di bawah untuk memproses foto secara instan.</div>`;
    }
  }

  renderBgColorPanel(drawer) {
    const sel = StateStore.getSelectedLayer();
    const extracted = sel ? ColorEngine.extractDominantPalette(sel.id, 4) : ['#6366f1', '#06b6d4'];
    const presets = ['#ffffff', '#db1514', '#0055b8', '#0f172a', '#10b981', ...extracted];

    drawer.innerHTML = `
      <div class="control-row">
        <label>Warna Latar:</label>
        <div class="swatch-row" id="bg-swatches"></div>
      </div>
      <div class="control-row">
        <label>Transparan / Gradasi:</label>
        <div style="display:flex;gap:6px">
          <button type="button" class="btn-xs" id="btn-bg-trans">Transparan</button>
          <button type="button" class="btn-xs" id="btn-bg-grad">Gradasi Studio</button>
          <input type="color" id="bg-custom-picker" value="#6366f1" title="Pilih Warna Kustom">
        </div>
      </div>
    `;

    const swatchBox = drawer.querySelector('#bg-swatches');
    presets.forEach((hex) => {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'color-swatch';
      s.style.background = hex;
      s.onclick = () => {
        StateStore.state.background.type = 'color';
        StateStore.state.background.color = hex;
        RenderEngine.requestRender();
      };
      swatchBox.appendChild(s);
    });

    drawer.querySelector('#btn-bg-trans').onclick = () => {
      StateStore.state.background.type = 'transparent';
      RenderEngine.requestRender();
    };
    drawer.querySelector('#btn-bg-grad').onclick = () => {
      StateStore.state.background.type = 'gradient';
      StateStore.state.background.gradient = ['#6366f1', '#06b6d4'];
      RenderEngine.requestRender();
    };
    drawer.querySelector('#bg-custom-picker').oninput = (e) => {
      StateStore.state.background.type = 'color';
      StateStore.state.background.color = e.target.value;
      RenderEngine.requestRender();
    };
  }

  renderLutPanel(drawer) {
    drawer.innerHTML = `<div class="swatch-row" id="lut-buttons"></div>`;
    const box = drawer.querySelector('#lut-buttons');
    Object.entries(LUT_PRESETS).forEach(([key, item]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-xs';
      b.textContent = item.label;
      b.onclick = () => {
        StateStore.state.optics.lut = key;
        RenderEngine.requestRender();
      };
      box.appendChild(b);
    });
  }

  renderPresetsPanel(drawer) {
    const items = [
      ['pasfoto_merah', 'Pas Foto Merah'],
      ['pasfoto_biru', 'Pas Foto Biru'],
      ['produk_umkm', 'Katalog Produk'],
      ['couple_warm', 'Couple Estetik'],
      ['yt_thumbnail', 'Thumbnail YT'],
      ['reels_safe', 'Reels / TikTok'],
      ['wa_sticker', 'Stiker WA']
    ];
    drawer.innerHTML = `<div class="swatch-row" id="preset-btns"></div>`;
    const box = drawer.querySelector('#preset-btns');
    items.forEach(([k, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-xs';
      b.textContent = label;
      b.onclick = () => applyCompositionPreset(k);
      box.appendChild(b);
    });
  }

  renderBrushPanel(drawer, mode) {
    StateStore.state.activeToolMode = mode;
    const names = {
      BRUSH_ERASE: 'Usap pada gambar untuk menghapus area secara presisi.',
      BRUSH_RESTORE: 'Usap untuk mengembalikan bagian gambar yang terhapus.',
      BLEMISH: 'Ketuk/usap jerawat, noda, atau objek kecil untuk menyamarkan.',
      SENSOR: 'Usap plat nomor, wajah, atau NIK untuk menyensor otomatis.'
    };
    drawer.innerHTML = `
      <div style="font-size:11.5px;margin-bottom:6px;color:var(--accent-secondary)">${names[mode]}</div>
      <div class="control-row">
        <label>Ukuran Kuas: <span id="brush-val">${StateStore.state.brush.size}</span>px</label>
        <input type="range" id="brush-size-slider" min="8" max="80" value="${StateStore.state.brush.size}">
      </div>
    `;
    drawer.querySelector('#brush-size-slider').oninput = (e) => {
      StateStore.state.brush.size = clamp(e.target.value, 8, 80, 28);
      drawer.querySelector('#brush-val').textContent = StateStore.state.brush.size;
    };
  }

  activateLassoMode(drawer) {
    StateStore.state.activeToolMode = 'LASSO';
    drawer.innerHTML = `<div class="drawer-placeholder">Gambar garis melingkari objek utama di kanvas, lalu lepas jari untuk memotong otomatis.</div>`;
  }

  renderOpticsPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <label>Bayangan Lantai:</label>
        <input type="range" id="opt-shadow" min="0" max="100" value="${StateStore.state.optics.floorShadow}">
      </div>
      <div class="control-row">
        <label>Rim Light Tepi:</label>
        <input type="range" id="opt-rim" min="0" max="100" value="${StateStore.state.optics.rimLightIntensity}">
      </div>
    `;
    drawer.querySelector('#opt-shadow').oninput = (e) => {
      StateStore.state.optics.floorShadow = Number(e.target.value);
      RenderEngine.requestRender();
    };
    drawer.querySelector('#opt-rim').oninput = (e) => {
      StateStore.state.optics.rimLightIntensity = Number(e.target.value);
      RenderEngine.requestRender();
    };
  }

  renderWatermarkPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <input type="text" id="wm-text-input" class="studio-input" value="© TOKO ORIGINAL" placeholder="Teks Watermark">
        <button type="button" id="btn-apply-wm" class="btn-primary btn-sm">Pasang</button>
      </div>
    `;
    drawer.querySelector('#btn-apply-wm').onclick = () => {
      const txt = drawer.querySelector('#wm-text-input').value || '© ORIGINAL';
      const base = RenderEngine.renderHighResExport(1.5);
      const wmCanvas = generateTiledWatermarkCanvas(base, txt);
      wmCanvas.toBlob((blob) => {
        ExporterBatch.downloadBlob(blob, `produk_watermark_${Date.now()}.jpg`);
        StudioBus.toast('Foto produk ber-watermark berhasil diunduh!');
      }, 'image/jpeg', 0.92);
    };
  }

  renderTargetKBPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <label>Target Maks (KB):</label>
        <input type="number" id="target-kb-input" class="studio-input" value="200" min="20" max="5000" style="max-width:100px">
        <button type="button" id="btn-run-kb" class="btn-primary btn-sm">Kompres & Unduh</button>
      </div>
    `;
    drawer.querySelector('#btn-run-kb').onclick = async () => {
      const kb = Number(drawer.querySelector('#target-kb-input').value) || 200;
      try {
        const res = await compressToTargetKB(kb, 'image/jpeg');
        ExporterBatch.downloadBlob(res.blob, `kompres_${res.finalKB}KB_adi88m.jpg`);
        StudioBus.toast(`Berhasil dikompres menjadi ${res.finalKB} KB!`);
      } catch (err) {
        StudioBus.toast(err.message);
      }
    };
  }

  renderPdfPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <button type="button" id="btn-cur-pdf" class="btn-primary btn-sm">Kanvas Ini ke PDF</button>
        <label class="btn-secondary btn-sm">Gabung Banyak Foto PDF
          <input type="file" id="multi-pdf-input" accept="image/*" multiple class="sr-only">
        </label>
      </div>
    `;
    drawer.querySelector('#btn-cur-pdf').onclick = () => exportImagesToPDF(null);
    drawer.querySelector('#multi-pdf-input').onchange = (e) => exportImagesToPDF(e.target.files);
  }

  renderQRPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <input type="text" id="qr-url-input" class="studio-input" value="https://adi88m.blogspot.com" placeholder="Masukkan URL / Teks QR">
        <button type="button" id="btn-make-qr" class="btn-primary btn-sm">+ Tambah QR</button>
      </div>
    `;
    drawer.querySelector('#btn-make-qr').onclick = () => {
      const val = drawer.querySelector('#qr-url-input').value;
      generateQRCodeLayer(val);
    };
  }

  renderOCRPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <button type="button" id="btn-run-ocr" class="btn-primary btn-sm">Mulai Baca Teks (OCR)</button>
        <button type="button" id="btn-copy-ocr" class="btn-secondary btn-sm">Salin Teks</button>
      </div>
      <textarea id="ocr-result-box" class="studio-input" rows="2" placeholder="Hasil teks dari gambar akan muncul di sini..."></textarea>
    `;
    drawer.querySelector('#btn-run-ocr').onclick = async () => {
      const txt = await extractTextFromActiveCanvas('ind+eng');
      drawer.querySelector('#ocr-result-box').value = txt;
    };
    drawer.querySelector('#btn-copy-ocr').onclick = () => {
      const val = drawer.querySelector('#ocr-result-box').value;
      if (val && navigator.clipboard) {
        navigator.clipboard.writeText(val);
        StudioBus.toast('Teks berhasil disalin ke clipboard!');
      }
    };
  }

  renderCollagePanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <label class="btn-primary btn-sm full-width">Pilih 2 - 6 Foto untuk Kolase Otomatis
          <input type="file" id="collage-files-input" accept="image/*" multiple class="sr-only">
        </label>
      </div>
    `;
    drawer.querySelector('#collage-files-input').onchange = (e) => {
      buildAutoCollageFromFiles(e.target.files);
    };
  }

  renderBatchZipPanel(drawer) {
    drawer.innerHTML = `
      <div class="control-row">
        <input type="text" id="batch-wm-input" class="studio-input" placeholder="Watermark opsional (mis: @adi88m)">
        <label class="btn-primary btn-sm">Pilih Banyak Foto (ZIP)
          <input type="file" id="batch-zip-input" accept="image/*" multiple class="sr-only">
        </label>
      </div>
    `;
    drawer.querySelector('#batch-zip-input').onchange = (e) => {
      const wm = drawer.querySelector('#batch-wm-input').value;
      ExporterBatch.processBatchToZip(e.target.files, { maxWidth: 1280, watermark: wm });
    };
  }

  handlePrintSheet(paper) {
    if (StateStore.state.layers.length === 0) {
      StudioBus.toast('Unggah foto terlebih dahulu sebelum membuat lembar cetak.');
      return;
    }
    const { canvas, count } = generatePrintSheetCanvas(paper, '3x4');
    canvas.toBlob((blob) => {
      ExporterBatch.downloadBlob(blob, `cetak_pasfoto_${paper}_${count}pcs_300dpi.jpg`);
      StudioBus.toast(`Lembar cetak ${paper} (${count} foto 300 DPI) siap dicetak!`);
    }, 'image/jpeg', 0.95);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const studio = new StudioAppCoordinator();
  studio.init();
  console.log(`[AI Image Studio — adi88m] Ready v${APP_VERSION}`);
});
