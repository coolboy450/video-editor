/* สตูดิโอตัดต่อ · noob_dev
   ประมวลผลในเบราว์เซอร์ทั้งหมด ไม่ส่งไฟล์ออกนอกเครื่อง */
'use strict';
(() => {
  /* ---------- ค่าคงที่ ---------- */
  const FPS = 30, CW = 1280, CH = 720;
  const KEY = 'noobdev.studio.project.v1';
  const MAX_HIST = 100;
  const MB = 1024 * 1024;
  const LIMITS = { v: 1024 * MB, a: 256 * MB, i: 30 * MB };
  const KIND_NAME = { v: 'วิดีโอ', a: 'เสียง', i: 'รูป' };
  const FILTERS = [
    ['bw', 'ขาวดำ', 'grayscale(1)'],
    ['vin', 'วินเทจ', 'sepia(.6) contrast(.9) saturate(.85)'],
    ['cool', 'เย็น', 'saturate(1.1) hue-rotate(-20deg) brightness(1.05)'],
    ['warm', 'อุ่น', 'sepia(.35) saturate(1.4) hue-rotate(-12deg)'],
    ['drama', 'ดราม่า', 'contrast(1.4) saturate(.75) brightness(.9)'],
    ['fade', 'ซีดฟิล์ม', 'contrast(.8) brightness(1.1) saturate(.6)'],
  ];
  const TEXT_SIZES = { s: 32, m: 48, l: 64 };
  const TEXT_COLORS = { text: '--ov-text', accent: '--ov-accent', pop: '--ov-pop', warn: '--ov-warn' };
  const ZOOMS = [25, 50, 75, 100, 150, 200, 300, 400, 600, 800];
  const BASE_PPS = 24;
  const EXT = {
    v: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi'],
    a: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'],
    i: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'],
  };
  const SUPPORTS_FILTER = 'filter' in CanvasRenderingContext2D.prototype;

  /* ---------- ตัวช่วย ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const pad = n => String(n).padStart(2, '0');
  const r3 = v => Math.round(v * 1000) / 1000;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const I = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function fmtTC(v) {
    v = Math.max(0, v);
    const h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60), s = Math.floor(v % 60), f = Math.floor((v % 1) * FPS);
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f)}`;
  }
  const fmtDur = v => { v = Math.max(0, Math.round(v)); return `${Math.floor(v / 60)}:${pad(v % 60)}`; };
  const fmtBytes = b => b >= 1024 * MB ? (b / MB / 1024).toFixed(1) + ' GB' : b >= MB ? (b / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const extOf = name => (name.split('.').pop() || '').toLowerCase();
  const safeName = s => (s || 'โปรเจกต์').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'โปรเจกต์';

  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  const OV = {};
  const readOv = () => {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['--ov-stage', '--ov-box', '--ov-text', '--ov-accent', '--ov-pop', '--ov-warn']) OV[k] = cs.getPropertyValue(k).trim();
  };
  readOv();

  /* ---------- สถานะโปรเจกต์ ---------- */
  const defFx = () => ({ b: 100, c: 100, s: 100, v: 100, f: null });
  const blank = () => ({ name: 'โปรเจกต์ไม่มีชื่อ', media: [], clips: [] });
  let P = blank();
  let sel = null;
  let t = 0, rate = 1, playing = false, last = 0, zoomIdx = 3;
  const rt = new Map();      // mediaId -> { file, url, el, ok, kind, node, gain }
  const thumbs = new Map();  // mediaId -> dataURL
  let libErrors = [];
  const undoStack = [], redoStack = [];
  let lastKey = null, lastTime = 0;

  const getMedia = id => P.media.find(m => m.id === id);
  const getClip = id => P.clips.find(c => c.id === id);
  const isOk = id => !!(rt.get(id) && rt.get(id).ok);
  const totalDur = () => P.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  const lookT = () => { const tot = totalDur(); return tot > 0 ? Math.min(t, tot - 0.0005) : t; };
  const pps = () => BASE_PPS * ZOOMS[zoomIdx] / 100;
  const isMobile = () => matchMedia('(max-width:899px)').matches;

  function activeClip(track, time) {
    let r = null;
    for (const c of P.clips) {
      if (c.track === track && time >= c.start - 1e-6 && time < c.start + c.dur - 1e-6 && (!r || c.start >= r.start)) r = c;
    }
    return r;
  }

  /* ---------- ข้อความแจ้ง ---------- */
  function toast(msg, type) {
    const box = $('#toasts');
    const d = document.createElement('div');
    d.className = 'toast' + (type === 'error' ? ' err' : '');
    if (type === 'error') d.setAttribute('role', 'alert');
    d.textContent = msg;
    box.append(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), type === 'error' ? 7000 : 3500);
  }

  /* ---------- ประวัติ Undo/Redo ---------- */
  function commit(fn, key) {
    const now = performance.now();
    if (!(key && key === lastKey && now - lastTime < 1000)) {
      undoStack.push(JSON.stringify(P));
      if (undoStack.length > MAX_HIST) undoStack.shift();
      redoStack.length = 0;
    }
    lastKey = key || null; lastTime = now;
    fn();
    afterChange();
  }
  function doUndo() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(P));
    P = JSON.parse(undoStack.pop());
    lastKey = null; afterChange();
  }
  function doRedo() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(P));
    P = JSON.parse(redoStack.pop());
    lastKey = null; afterChange();
  }
  function afterChange() {
    if (sel && !getClip(sel)) sel = null;
    t = clamp(t, 0, totalDur());
    sync(); renderAll(); scheduleSave();
  }

  /* ---------- ตรวจและล้างข้อมูลโปรเจกต์ (จาก localStorage / ไฟล์ JSON) ---------- */
  function sanitize(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('bad');
    const idOk = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s);
    const nz = (v, d, lo, hi) => typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : d;
    const out = { name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 60) : 'โปรเจกต์ไม่มีชื่อ', media: [], clips: [] };
    const seen = new Set();
    for (const m of (Array.isArray(o.media) ? o.media : []).slice(0, 300)) {
      if (!m || typeof m !== 'object' || !idOk(m.id) || seen.has(m.id) || !['v', 'a', 'i'].includes(m.kind)) continue;
      seen.add(m.id);
      out.media.push({ id: m.id, name: String(m.name || 'ไม่มีชื่อ').slice(0, 200), kind: m.kind, dur: nz(m.dur, 0, 0, 86400), w: nz(m.w, 0, 0, 20000), h: nz(m.h, 0, 0, 20000), size: nz(m.size, 0, 0, 1e13) });
    }
    const cids = new Set();
    for (const c of (Array.isArray(o.clips) ? o.clips : []).slice(0, 2000)) {
      if (!c || typeof c !== 'object' || !idOk(c.id) || cids.has(c.id) || !['v', 'a', 't'].includes(c.track)) continue;
      const dur = nz(c.dur, 0, 0, 86400);
      if (dur < 0.05) continue;
      const base = { id: c.id, track: c.track, start: r3(nz(c.start, 0, 0, 86400)), dur: r3(dur), in: r3(nz(c.in, 0, 0, 86400)), media: null, fx: defFx(), text: null };
      if (c.track === 't') {
        const tx = c.text && typeof c.text === 'object' ? c.text : {};
        base.text = {
          str: String(tx.str == null ? '' : tx.str).slice(0, 120),
          size: ['s', 'm', 'l'].includes(tx.size) ? tx.size : 'm',
          color: Object.keys(TEXT_COLORS).includes(tx.color) ? tx.color : 'text',
          x: nz(tx.x, 50, 0, 100), y: nz(tx.y, 85, 0, 100),
        };
      } else {
        const m = out.media.find(x => x.id === c.media);
        if (!m || (c.track === 'a') !== (m.kind === 'a')) continue;
        base.media = m.id;
        const f = c.fx && typeof c.fx === 'object' ? c.fx : {};
        base.fx = { b: nz(f.b, 100, 0, 200), c: nz(f.c, 100, 0, 200), s: nz(f.s, 100, 0, 200), v: nz(f.v, 100, 0, 200), f: FILTERS.some(x => x[0] === f.f) ? f.f : null };
      }
      cids.add(c.id); out.clips.push(base);
    }
    return out;
  }

  /* ---------- บันทึกอัตโนมัติ ---------- */
  let saveTimer = 0, saveWarned = false, savedLabel = '';
  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function save() {
    try {
      const th = {};
      for (const m of P.media) if (thumbs.has(m.id)) th[m.id] = thumbs.get(m.id);
      localStorage.setItem(KEY, JSON.stringify({ v: 1, project: P, thumbs: th, zoomIdx }));
      const d = new Date();
      savedLabel = `บันทึกอัตโนมัติ ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (e) {
      savedLabel = 'บันทึกอัตโนมัติไม่สำเร็จ';
      if (!saveWarned) { saveWarned = true; toast('บันทึกอัตโนมัติไม่สำเร็จ พื้นที่เก็บของเบราว์เซอร์เต็มหรือถูกปิดไว้ ลองส่งออกโปรเจกต์เป็นไฟล์ .json เก็บไว้นะ', 'error'); }
    }
    $('#savedAt').textContent = savedLabel;
    $('#exSavedAt').textContent = savedLabel;
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      P = sanitize(d.project);
      if (d.thumbs && typeof d.thumbs === 'object') {
        for (const [k, v] of Object.entries(d.thumbs)) {
          if (typeof v === 'string' && v.startsWith('data:image/') && v.length < 80000 && P.media.some(m => m.id === k)) thumbs.set(k, v);
        }
      }
      if (Number.isInteger(d.zoomIdx)) zoomIdx = clamp(d.zoomIdx, 0, ZOOMS.length - 1);
      return true;
    } catch (e) { return false; }
  }

  /* ---------- นำเข้าไฟล์ ---------- */
  function detectKind(f) {
    const ty = f.type || '';
    if (ty.startsWith('video/')) return 'v';
    if (ty.startsWith('audio/')) return 'a';
    if (ty.startsWith('image/')) return 'i';
    const e = extOf(f.name);
    for (const k of ['v', 'a', 'i']) if (EXT[k].includes(e)) return k;
    return null;
  }
  function makeThumb(src, w, h) {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const x = c.getContext('2d');
    x.fillStyle = OV['--ov-stage']; x.fillRect(0, 0, 160, 90);
    const s = Math.max(160 / w, 90 / h);
    x.drawImage(src, (160 - w * s) / 2, (90 - h * s) / 2, w * s, h * s);
    return c.toDataURL('image/jpeg', 0.6);
  }
  function openFail(file, kind) {
    const e = extOf(file.name);
    if (kind === 'i') return `เบราว์เซอร์นี้เปิดรูป "${file.name}" ไม่ได้ ลองบันทึกเป็น .jpg หรือ .png ก่อนนะ`;
    return `เบราว์เซอร์นี้เปิดไฟล์ .${e || 'นี้'} ไม่ได้ ลองแปลงเป็น ${kind === 'v' ? '.mp4' : '.mp3'} ก่อนนะ`;
  }
  function probe(file, kind) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const fail = msg => { URL.revokeObjectURL(url); reject(new Error(msg)); };
      if (kind === 'i') {
        const img = new Image();
        img.onload = () => {
          if (!img.naturalWidth) return fail(openFail(file, kind));
          resolve({ el: img, url, dur: 0, w: img.naturalWidth, h: img.naturalHeight, thumb: makeThumb(img, img.naturalWidth, img.naturalHeight) });
        };
        img.onerror = () => fail(openFail(file, kind));
        img.src = url;
        return;
      }
      const el = document.createElement(kind === 'v' ? 'video' : 'audio');
      el.preload = 'auto';
      if (kind === 'v') el.playsInline = true;
      const timer = setTimeout(() => fail(openFail(file, kind)), 20000);
      el.onerror = () => { clearTimeout(timer); fail(openFail(file, kind)); };
      el.onloadedmetadata = () => {
        if (!isFinite(el.duration) || el.duration <= 0) { clearTimeout(timer); return fail(`อ่านความยาวของ "${file.name}" ไม่ได้ ไฟล์อาจเสียหรือยังไม่สมบูรณ์`); }
        if (kind === 'a') { clearTimeout(timer); return resolve({ el, url, dur: el.duration, w: 0, h: 0, thumb: '' }); }
        if (!el.videoWidth) { clearTimeout(timer); return fail(`ไม่พบภาพใน "${file.name}" เบราว์เซอร์อาจเปิดตัวแปลงภาพของไฟล์นี้ไม่ได้ ลองแปลงเป็น .mp4 (H.264) ก่อนนะ`); }
        el.onseeked = () => {
          el.onseeked = null; clearTimeout(timer);
          let thumb = '';
          try { thumb = makeThumb(el, el.videoWidth, el.videoHeight); } catch (e) { /* ใช้ไอคอนแทน */ }
          el.currentTime = 0;
          resolve({ el, url, dur: el.duration, w: el.videoWidth, h: el.videoHeight, thumb });
        };
        el.currentTime = Math.min(0.5, el.duration / 2);
      };
      el.src = url;
    });
  }
  function register(id, kind, file, info) {
    const old = rt.get(id);
    if (old && old.url) URL.revokeObjectURL(old.url);
    const el = info.el;
    if (kind !== 'i') { el.addEventListener('seeked', requestDraw); el.addEventListener('loadeddata', requestDraw); }
    rt.set(id, { file, url: info.url, el, ok: true, kind, node: null, gain: null });
    if (info.thumb) thumbs.set(id, info.thumb);
  }
  function addLibError(name, msg) {
    libErrors.push({ id: uid(), name, msg });
    renderLibrary(true);
    toast(msg, 'error');
  }
  async function importFiles(files) {
    files = [...files];
    if (!files.length) return;
    let added = 0;
    for (const f of files) {
      const kind = detectKind(f);
      if (!kind) { addLibError(f.name, `"${f.name}" เปิดไม่ได้ รองรับเฉพาะไฟล์วิดีโอ เสียง และรูปนะ`); continue; }
      if (f.size > LIMITS[kind]) { addLibError(f.name, `"${f.name}" ใหญ่เกินไป (${fmtBytes(f.size)}) วิดีโอรับได้ไม่เกิน 1 GB เสียงไม่เกิน 256 MB รูปไม่เกิน 30 MB`); continue; }
      if (f.size === 0) { addLibError(f.name, `"${f.name}" เป็นไฟล์ว่าง เลือกไฟล์ใหม่อีกครั้งนะ`); continue; }
      let info;
      try { info = await probe(f, kind); } catch (e) { addLibError(f.name, e.message); continue; }
      const miss = P.media.find(m => !isOk(m.id) && m.name === f.name && m.size === f.size && m.kind === kind);
      if (miss) {
        register(miss.id, kind, f, info);
        renderAll();
        toast(`เชื่อมไฟล์ "${f.name}" กลับเข้าโปรเจกต์แล้ว`);
        continue;
      }
      const id = uid();
      register(id, kind, f, info);
      commit(() => P.media.push({ id, name: f.name, kind, dur: r3(info.dur), w: info.w, h: info.h, size: f.size }));
      added++;
    }
    if (added) toast(added === 1 ? 'เพิ่มไฟล์เข้าคลังแล้ว' : `เพิ่ม ${added} ไฟล์เข้าคลังแล้ว`);
  }
  function removeMedia(id) {
    const m = getMedia(id);
    if (!m) return;
    const r = rt.get(id);
    if (r && r.el && r.kind !== 'i') r.el.pause();
    commit(() => { P.media = P.media.filter(x => x.id !== id); P.clips = P.clips.filter(c => c.media !== id); });
    toast(`เอา "${m.name}" ออกจากคลังแล้ว กด Ctrl+Z เพื่อเอาคืนได้`);
  }

  /* ---------- เสียง (Web Audio) ---------- */
  let ac = null, outGain = null, expDest = null;
  function prepareAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ac) {
      try {
        ac = new AC();
        outGain = ac.createGain();
        outGain.connect(ac.destination);
        expDest = ac.createMediaStreamDestination();
      } catch (e) { ac = null; return; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    for (const r of rt.values()) {
      if (r.ok && r.kind !== 'i' && !r.node) {
        try {
          const src = ac.createMediaElementSource(r.el);
          const g = ac.createGain();
          src.connect(g); g.connect(outGain); g.connect(expDest);
          r.node = src; r.gain = g;
        } catch (e) { /* ใช้ระดับเสียงของตัวเล่นตรง ๆ */ }
      }
    }
  }
  function setGain(r, v) {
    if (r.gain) r.gain.gain.value = v;
    else r.el.volume = clamp(v, 0, 1);
  }

  /* ---------- เล่น / ซิงก์ / วาดพรีวิว ---------- */
  function sync() {
    const tt = lookT();
    const active = new Set();
    for (const tr of ['v', 'a']) {
      const c = activeClip(tr, tt);
      if (!c) continue;
      const r = rt.get(c.media);
      if (!r || !r.ok || r.kind === 'i') continue;
      const el = r.el;
      active.add(el);
      setGain(r, c.fx.v / 100);
      const target = c.in + (tt - c.start);
      if (playing) {
        if (el.playbackRate !== rate) el.playbackRate = rate;
        if (el.paused) {
          if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
          const p = el.play();
          if (p && p.catch) p.catch(() => {});
        } else if (Math.abs(el.currentTime - target) > 0.3) {
          el.currentTime = target;
        }
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.02) el.currentTime = target;
      }
    }
    for (const r of rt.values()) {
      if (r.ok && r.kind !== 'i' && !active.has(r.el)) {
        if (!r.el.paused) r.el.pause();
        if (r.gain) r.gain.gain.value = 0;
      }
    }
  }

  const filterCss = fx => {
    const parts = [];
    const f = FILTERS.find(x => x[0] === fx.f);
    if (f) parts.push(f[2]);
    if (fx.b !== 100) parts.push(`brightness(${fx.b}%)`);
    if (fx.c !== 100) parts.push(`contrast(${fx.c}%)`);
    if (fx.s !== 100) parts.push(`saturate(${fx.s}%)`);
    return parts.join(' ') || 'none';
  };
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  }
  function drawText(c) {
    const tx = c.text;
    if (!tx || !tx.str) return;
    let fs = TEXT_SIZES[tx.size] || 56;
    const fam = '"IBM Plex Sans Thai", system-ui, sans-serif';
    ctx.font = `700 ${fs}px ${fam}`;
    let w = ctx.measureText(tx.str).width;
    const maxW = CW * 0.9 - 48;
    if (w > maxW) { fs = Math.max(12, Math.floor(fs * maxW / w)); ctx.font = `700 ${fs}px ${fam}`; w = ctx.measureText(tx.str).width; }
    const bw = w + 48, bh = fs * 1.7;
    const cx = clamp(CW * tx.x / 100, 16 + bw / 2, CW - 16 - bw / 2);
    const cy = clamp(CH * tx.y / 100, 16 + bh / 2, CH - 16 - bh / 2);
    ctx.fillStyle = OV['--ov-box'];
    roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 12);
    ctx.fillStyle = OV[TEXT_COLORS[tx.color]] || OV['--ov-text'];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tx.str, cx, cy);
  }
  let noteText = '';
  function draw() {
    ctx.save();
    ctx.filter = 'none';
    ctx.fillStyle = OV['--ov-stage'];
    ctx.fillRect(0, 0, CW, CH);
    const tt = lookT();
    const vc = activeClip('v', tt);
    let note = '';
    if (vc) {
      const r = rt.get(vc.media);
      if (r && r.ok) {
        const el = r.el;
        const sw = r.kind === 'i' ? el.naturalWidth : el.videoWidth;
        const sh = r.kind === 'i' ? el.naturalHeight : el.videoHeight;
        if (sw && sh && (r.kind === 'i' || el.readyState >= 2)) {
          const s = Math.min(CW / sw, CH / sh);
          const dw = sw * s, dh = sh * s;
          if (SUPPORTS_FILTER) ctx.filter = filterCss(vc.fx);
          ctx.drawImage(el, (CW - dw) / 2, (CH - dh) / 2, dw, dh);
          ctx.filter = 'none';
        }
      } else {
        const m = getMedia(vc.media);
        note = `ไฟล์ "${m ? m.name : ''}" ยังไม่ได้เลือกใหม่ เลือกไฟล์ชื่อเดิมในคลังเพื่อเชื่อมกลับ`;
      }
    }
    P.clips.filter(c => c.track === 't' && tt >= c.start - 1e-6 && tt < c.start + c.dur - 1e-6).forEach(drawText);
    ctx.restore();
    if (note !== noteText) {
      noteText = note;
      const n = $('#stageNote');
      n.textContent = note; n.hidden = !note;
    }
  }
  let drawQ = false;
  function requestDraw() {
    if (drawQ) return;
    drawQ = true;
    requestAnimationFrame(() => { drawQ = false; draw(); });
  }

  const btnPlay = $('#btnPlay'), seek = $('#seek'), playheadEl = $('#playhead'), tlScroll = $('#tlScroll');
  function updateTransport() {
    const tot = totalDur();
    $('#tc').textContent = fmtTC(t);
    $('#tcTotal').textContent = ' / ' + fmtTC(tot);
    seek.value = tot ? Math.round(t / tot * 1000) : 0;
    seek.disabled = !tot;
    seek.setAttribute('aria-valuetext', fmtTC(t));
    const x = t * pps();
    playheadEl.style.left = x + 'px';
    if (playing) {
      const l = tlScroll.scrollLeft, w = tlScroll.clientWidth;
      if (w && (x > l + w - 24 || x < l)) tlScroll.scrollLeft = Math.max(0, x - 48);
    }
    $('#stageHint').hidden = P.clips.length > 0;
    if (exp && exp.active) updateExportUI();
  }
  function setTime(v) {
    t = clamp(v, 0, totalDur());
    sync(); draw(); updateTransport();
  }
  function tick(now) {
    if (!playing) return;
    const dt = clamp((now - last) / 1000, 0, 0.25);
    last = now;
    const tot = totalDur();
    t += dt * rate;
    if (t >= tot) {
      t = tot;
      setPlaying(false);
      updateTransport(); draw();
      if (exp && exp.active) finishExport();
      return;
    }
    sync(); draw(); updateTransport();
    requestAnimationFrame(tick);
  }
  function setPlaying(v) {
    if (v) {
      const tot = totalDur();
      if (!tot) { toast('ยังไม่มีคลิปบนไทม์ไลน์ ลากไฟล์จากคลังมาวางก่อนนะ'); return; }
      if (t >= tot - 0.01) t = 0;
      prepareAudio();
      playing = true; last = performance.now();
      sync();
      requestAnimationFrame(tick);
    } else {
      playing = false;
      sync();
    }
    btnPlay.innerHTML = I(playing ? 'pause' : 'play');
    btnPlay.setAttribute('aria-label', playing ? 'หยุด (Space)' : 'เล่น (Space)');
  }
  const togglePlay = () => setPlaying(!playing);
  function stepFrames(n) {
    if (playing) setPlaying(false);
    t = Math.round(t * FPS) / FPS;
    setTime(t + n / FPS);
  }
  function setRate(r) {
    rate = r;
    $$('[data-rate]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.rate) === r)));
    if (playing) sync();
  }

  /* ---------- ไทม์ไลน์: วาด ---------- */
  const lanesEl = $('#tlLanes'), laneV = $('#laneV'), laneA = $('#laneA'), laneT = $('#laneT');
  function clipHtml(c, row) {
    const m = c.media ? getMedia(c.media) : null;
    const miss = m && !isOk(m.id);
    let inner = '', label;
    if (c.track === 't') {
      const s = c.text.str || '(ข้อความว่าง)';
      inner = `<span>${esc(s)}</span>`;
      label = `ข้อความ ${s}`;
    } else if (c.track === 'a') {
      inner = `<span>${esc(m.name)}</span><i class="wv"></i>`;
      label = `คลิปเสียง ${m.name}`;
    } else {
      const th = thumbs.get(m.id);
      inner = `${th ? `<img src="${th}" alt="">` : ''}<span>${esc(m.name)}</span>`;
      label = `คลิป${m.kind === 'i' ? 'รูป' : 'วิดีโอ'} ${m.name}`;
    }
    label += ` เริ่ม ${fmtDur(c.start)} ยาว ${r3(c.dur)} วินาที${miss ? ' (ไฟล์ยังไม่ได้เลือกใหม่)' : ''}`;
    const pos = `left:${c.start * pps()}px;width:${Math.max(4, c.dur * pps())}px` + (c.track === 't' ? `;top:${4 + row * rowPitch()}px;bottom:auto;height:${rowPitch() - 8}px` : '');
    return `<div class="clip ${c.track}${c.id === sel ? ' sel' : ''}${miss ? ' miss' : ''}" role="button" tabindex="0" aria-pressed="${c.id === sel}" data-id="${c.id}" aria-label="${esc(label)}" title="${esc(label)}" style="${pos}">${inner}</div>`;
  }
  const isMob = () => window.matchMedia('(max-width:899px)').matches;
  const rowPitch = () => (isMob() ? 52 : 40);
  const laneMin = () => (isMob() ? 64 : 48);
  function renderTimeline() {
    const focusId = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('clip') ? document.activeElement.dataset.id : null;
    const p = pps();
    const width = Math.max(tlScroll.clientWidth, (totalDur() + 12) * p);
    lanesEl.style.width = width + 'px';
    const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const step = steps.find(s => s * p >= 72) || 3600;
    let rh = '';
    for (let s = 0; s * p < width; s += step) rh += `<span style="left:${s * p}px">${fmtDur(s)}</span>`;
    $('#ruler').innerHTML = rh;
    const by = tr => P.clips.filter(c => c.track === tr);
    laneV.innerHTML = by('v').map(c => clipHtml(c, 0)).join('');
    laneA.innerHTML = by('a').map(c => clipHtml(c, 0)).join('');
    const ts = by('t').sort((a, b) => a.start - b.start);
    const rowsEnd = [];
    let th = '';
    for (const c of ts) {
      let row = rowsEnd.findIndex(e => e <= c.start + 1e-6);
      if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); }
      rowsEnd[row] = c.start + c.dur;
      th += clipHtml(c, row);
    }
    laneT.innerHTML = th;
    const hT = Math.max(laneMin(), rowsEnd.length * rowPitch() + 8);
    laneT.style.height = hT + 'px';
    $('#headT').style.height = hT + 'px';
    $('#zoomV').textContent = ZOOMS[zoomIdx] + '%';
    $('#btnZoomOut').disabled = zoomIdx === 0;
    $('#btnZoomIn').disabled = zoomIdx === ZOOMS.length - 1;
    playheadEl.style.left = t * p + 'px';
    if (focusId) { const f = $(`.clip[data-id="${focusId}"]`, lanesEl); if (f) f.focus({ preventScroll: true }); }
  }
  function setZoom(i) {
    i = clamp(i, 0, ZOOMS.length - 1);
    if (i === zoomIdx) return;
    const off = t * pps() - tlScroll.scrollLeft;
    zoomIdx = i;
    renderTimeline();
    tlScroll.scrollLeft = Math.max(0, t * pps() - off);
    scheduleSave();
  }

  /* ---------- ไทม์ไลน์: ตำแหน่ง / ลาก / ตัด / ลบ ---------- */
  function fit(c, desired) {
    desired = Math.max(0, desired);
    if (c.track === 't') return desired;
    const others = P.clips.filter(o => o.track === c.track && o.id !== c.id);
    const ok = s => s >= -1e-6 && others.every(o => s + c.dur <= o.start + 1e-6 || s >= o.start + o.dur - 1e-6);
    const cands = [desired];
    for (const o of others) { cands.push(o.start + o.dur, o.start - c.dur); }
    cands.push(0);
    const list = cands.filter(ok);
    if (!list.length) return desired;
    return list.reduce((a, b) => Math.abs(b - desired) < Math.abs(a - desired) ? b : a);
  }
  function snap(c, s) {
    const thr = 8 / pps();
    const pts = [t, 0];
    for (const o of P.clips) if (o.id !== c.id && o.track === c.track) pts.push(o.start, o.start + o.dur);
    let best = s, bd = thr;
    for (const p of pts) {
      let d = Math.abs(s - p);
      if (d < bd) { bd = d; best = p; }
      d = Math.abs(s + c.dur - p);
      if (d < bd) { bd = d; best = p - c.dur; }
    }
    return Math.max(0, best);
  }
  function selectClip(id) {
    sel = id;
    $$('.clip', lanesEl).forEach(el => { const on = el.dataset.id === id; el.classList.toggle('sel', on); el.setAttribute('aria-pressed', String(on)); });
    renderInspector();
  }
  const timeFromX = x => (x - lanesEl.getBoundingClientRect().left) / pps();

  let drag = null, scrub = false;
  lanesEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const ce = e.target.closest('.clip');
    if (ce) {
      selectClip(ce.dataset.id);
      const c = getClip(ce.dataset.id);
      if (!c) return;
      drag = { id: c.id, el: ce, x0: e.clientX, s0: c.start, ns: c.start, moved: false };
      try { ce.setPointerCapture(e.pointerId); } catch (err) { /* ข้าม */ }
      return;
    }
    scrub = true;
    if (!e.target.closest('.ruler')) selectClip(null);
    setTime(timeFromX(e.clientX));
    try { lanesEl.setPointerCapture(e.pointerId); } catch (err) { /* ข้าม */ }
  });
  lanesEl.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x0;
      if (!drag.moved && Math.abs(dx) < 4) return;
      drag.moved = true;
      drag.el.classList.add('drag');
      const c = getClip(drag.id);
      if (!c) return;
      drag.ns = snap(c, drag.s0 + dx / pps());
      drag.el.style.left = drag.ns * pps() + 'px';
    } else if (scrub) {
      setTime(timeFromX(e.clientX));
    }
  });
  const endPointer = e => {
    if (drag) {
      const d = drag; drag = null;
      d.el.classList.remove('drag');
      if (d.moved) {
        commit(() => { const c = getClip(d.id); if (c) c.start = r3(fit(c, d.ns)); });
      }
    }
    scrub = false;
  };
  lanesEl.addEventListener('pointerup', endPointer);
  lanesEl.addEventListener('pointercancel', () => { drag = null; scrub = false; renderTimeline(); });
  lanesEl.addEventListener('focusin', e => {
    const ce = e.target.closest && e.target.closest('.clip');
    if (ce && sel !== ce.dataset.id) selectClip(ce.dataset.id);
  });
  tlScroll.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setZoom(zoomIdx + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  // วางจากคลัง
  let dragMediaId = null;
  const laneFor = id => { const m = getMedia(id); return m ? (m.kind === 'a' ? laneA : laneV) : null; };
  lanesEl.addEventListener('dragover', e => {
    if (!dragMediaId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const ln = laneFor(dragMediaId);
    [laneV, laneA].forEach(l => l.classList.toggle('hint', l === ln));
  });
  lanesEl.addEventListener('dragleave', () => [laneV, laneA].forEach(l => l.classList.remove('hint')));
  lanesEl.addEventListener('drop', e => {
    if (!dragMediaId) return;
    e.preventDefault(); e.stopPropagation();
    [laneV, laneA].forEach(l => l.classList.remove('hint'));
    const id = dragMediaId; dragMediaId = null;
    addClip(id, timeFromX(e.clientX));
  });

  function addClip(mid, start) {
    const m = getMedia(mid);
    if (!m) return;
    if (!isOk(mid)) { toast(`ไฟล์ "${m.name}" ยังไม่ได้เลือกใหม่ กดเลือกไฟล์ชื่อเดิมอีกครั้งก่อนนะ`, 'error'); return; }
    const c = { id: uid(), media: mid, track: m.kind === 'a' ? 'a' : 'v', start: 0, dur: m.kind === 'i' ? 5 : Math.max(0.1, r3(m.dur)), in: 0, fx: defFx(), text: null };
    commit(() => { c.start = r3(fit(c, start)); P.clips.push(c); sel = c.id; });
    const el = $(`.clip[data-id="${c.id}"]`, lanesEl);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (isMobile()) setTab('tl');
  }
  function addToEnd(mid) {
    const m = getMedia(mid);
    if (!m) return;
    const track = m.kind === 'a' ? 'a' : 'v';
    addClip(mid, P.clips.filter(c => c.track === track).reduce((x, c) => Math.max(x, c.start + c.dur), 0));
  }
  function addText() {
    const c = { id: uid(), media: null, track: 't', start: r3(t), dur: 3, in: 0, fx: defFx(), text: { str: 'ข้อความใหม่', size: 'm', color: 'text', x: 50, y: 85 } };
    commit(() => { P.clips.push(c); sel = c.id; });
    toast('เพิ่มข้อความแล้ว แก้ข้อความได้ที่แท็บปรับค่า');
  }
  function cutAtPlayhead() {
    const inside = c => t > c.start + 0.05 && t < c.start + c.dur - 0.05;
    const s = sel && getClip(sel);
    let targets = s && inside(s) ? [s] : P.clips.filter(inside);
    if (!targets.length) { toast('วางหัวอ่านไว้กลางคลิปก่อน แล้วค่อยกดตัดนะ'); return; }
    const cut = r3(t);
    commit(() => {
      for (const c0 of targets) {
        const c = getClip(c0.id);
        const d = r3(cut - c.start);
        const n = JSON.parse(JSON.stringify(c));
        n.id = uid(); n.start = cut; n.dur = r3(c.dur - d); n.in = r3(c.in + d);
        c.dur = d;
        P.clips.push(n);
        if (sel === c.id || targets.length === 1) sel = n.id;
      }
    });
  }
  function deleteSelected() {
    if (!sel || !getClip(sel)) { toast('เลือกคลิปบนไทม์ไลน์ก่อนนะ'); return; }
    const id = sel;
    commit(() => { P.clips = P.clips.filter(c => c.id !== id); sel = null; });
  }

  /* ---------- คลังไฟล์: วาด ---------- */
  let libSig = '';
  function thumbHtml(m, ok) {
    const th = thumbs.get(m.id);
    if (!ok) return `<span class="thumb t-miss">${I('alert')}</span>`;
    const badge = `<span class="dur">${m.kind === 'i' ? 'รูป' : fmtDur(m.dur)}</span>`;
    if (m.kind === 'a') return `<span class="thumb"><i class="wave"></i>${badge}</span>`;
    return `<span class="thumb">${th ? `<img src="${th}" alt="">` : ''}${badge}</span>`;
  }
  function renderLibrary(force) {
    const sig = P.media.map(m => m.id + m.name + (isOk(m.id) ? 1 : 0)).join('|') + '#' + libErrors.map(e => e.id).join(',');
    if (!force && sig === libSig) return;
    libSig = sig;
    let h = libErrors.map(e => `<div class="media err" data-id="${e.id}" role="alert"><span class="thumb t-err">${I('alert')}</span><span class="m-txt"><span class="m-name" title="${esc(e.name)}">${esc(e.name)}</span><span class="err-msg">${esc(e.msg)}</span></span><span class="m-acts"><button type="button" class="ibtn" data-dismiss aria-label="ปิดข้อความนี้" title="ปิดข้อความนี้">${I('x')}</button></span></div>`).join('');
    for (const m of P.media) {
      const ok = isOk(m.id);
      const meta = `${KIND_NAME[m.kind]}${m.w ? ` · ${m.w}×${m.h}` : ''} · ${fmtBytes(m.size)}`;
      h += `<div class="media${ok ? '' : ' miss'}" data-id="${m.id}"${ok ? ' draggable="true"' : ''}>${thumbHtml(m, ok)}<span class="m-txt"><span class="m-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="m-meta">${esc(meta)}</span>${ok ? '' : '<span class="warn-msg">ไฟล์ไม่ได้เก็บไว้ในเบราว์เซอร์ เลือกไฟล์ชื่อเดิมอีกครั้งเพื่อเชื่อมกลับ</span>'}</span><span class="m-acts">${ok ? `<button type="button" class="ibtn" data-add aria-label="เพิ่ม ${esc(m.name)} ลงไทม์ไลน์" title="เพิ่มลงไทม์ไลน์">${I('plus')}</button>` : `<button type="button" class="ibtn" data-relink aria-label="เลือกไฟล์ ${esc(m.name)} ใหม่" title="เลือกไฟล์ใหม่">${I('upload')}</button>`}<button type="button" class="ibtn" data-rm aria-label="เอา ${esc(m.name)} ออกจากคลัง" title="เอาออกจากคลัง">${I('trash')}</button></span></div>`;
    }
    if (!h) h = '<p class="fine empty">ยังไม่มีไฟล์ ลากมาวางหรือกดเลือกไฟล์ได้เลย</p>';
    $('#mediaList').innerHTML = h;
  }
  const mediaList = $('#mediaList');
  mediaList.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const id = b.closest('.media').dataset.id;
    if (b.hasAttribute('data-add')) addToEnd(id);
    else if (b.hasAttribute('data-rm')) removeMedia(id);
    else if (b.hasAttribute('data-relink')) $('#fileIn').click();
    else if (b.hasAttribute('data-dismiss')) { libErrors = libErrors.filter(x => x.id !== id); renderLibrary(true); }
  });
  mediaList.addEventListener('dblclick', e => {
    const it = e.target.closest('.media[draggable="true"]');
    if (it && !e.target.closest('button')) addToEnd(it.dataset.id);
  });
  mediaList.addEventListener('dragstart', e => {
    const it = e.target.closest('.media[draggable="true"]');
    if (!it) return;
    dragMediaId = it.dataset.id;
    it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', it.dataset.id);
  });
  mediaList.addEventListener('dragend', () => { dragMediaId = null; $$('.media.dragging').forEach(x => x.classList.remove('dragging')); });

  // ลากไฟล์จากเครื่อง
  const drop = $('#drop');
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; drop.classList.add('over'); } });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; drop.classList.remove('over'); } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0; drop.classList.remove('over');
    if (isMobile()) setTab('lib');
    importFiles(e.dataTransfer.files);
  });
  $('#btnPick').addEventListener('click', () => $('#fileIn').click());
  $('#fileIn').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; importFiles(f); });

  /* ---------- แผงปรับค่า ---------- */
  const FILTER_BOX = $('#filters');
  FILTER_BOX.innerHTML = FILTERS.map(f => `<button type="button" class="ftile" data-filter="${f[0]}" aria-pressed="false"><span class="thumb"><span class="scene" style="filter:${f[2]}"><i class="sun"></i><i class="hill h1"></i><i class="hill h2"></i></span></span>${f[1]}</button>`).join('');
  $('#posGrid').innerHTML = [15, 50, 85].flatMap((y, yi) => [15, 50, 85].map((x, xi) => `<button type="button" data-pos="${x},${y}" aria-label="${['บน', 'กลาง', 'ล่าง'][yi]}${['ซ้าย', 'กลาง', 'ขวา'][xi]}" aria-pressed="false"></button>`)).join('');
  if (!SUPPORTS_FILTER) {
    $('#fxNote').hidden = false;
    $$('[data-fx="b"],[data-fx="c"],[data-fx="s"]').forEach(i => { i.disabled = true; });
    $$('.ftile').forEach(b => { b.disabled = true; });
  }

  function setVal(inp, v) { if (document.activeElement !== inp && inp.value !== String(v)) inp.value = v; }
  function renderInspector() {
    const c = sel && getClip(sel);
    const m = c && c.media ? getMedia(c.media) : null;
    $('#inspTitle').textContent = c ? `// ปรับคลิป · ${c.track === 't' ? 'ข้อความ' : (m ? m.name : '')}` : '// ปรับคลิป';
    $('#inspEmpty').hidden = !!c;
    $('#secAdjust').hidden = !(c && c.track !== 't');
    $('#secText').hidden = !(c && c.track === 't');
    if (!c) return;
    if (c.track !== 't') {
      const isV = c.track === 'v';
      $('#fxVisual').hidden = !isV;
      $('#secFilter').hidden = !isV;
      $('#ctlVol').hidden = !!(m && m.kind === 'i');
      $$('[data-fx]').forEach(inp => {
        const k = inp.dataset.fx;
        inp.value = c.fx[k];
        inp.previousElementSibling.textContent = c.fx[k] + '%';
      });
      $$('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(c.fx.f === b.dataset.filter)));
    } else {
      const tx = c.text;
      setVal($('#txtStr'), tx.str);
      $$('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === tx.size)));
      $$('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === tx.color)));
      $$('[data-pos]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pos === `${tx.x},${tx.y}`)));
      setVal($('#txtStart'), r3(c.start));
      setVal($('#txtEnd'), r3(c.start + c.dur));
    }
  }
  $$('[data-fx]').forEach(inp => {
    inp.addEventListener('input', () => {
      const c = sel && getClip(sel);
      if (!c) return;
      const k = inp.dataset.fx;
      commit(() => { getClip(c.id).fx[k] = Number(inp.value); }, `fx:${c.id}:${k}`);
    });
  });
  $$('input[type="range"]').forEach(r => r.addEventListener('pointerup', () => r.blur()));
  FILTER_BOX.addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    const c = sel && getClip(sel);
    if (!b || !c) return;
    commit(() => { const f = getClip(c.id).fx; f.f = f.f === b.dataset.filter ? null : b.dataset.filter; });
  });
  $('#btnReset').addEventListener('click', () => {
    const c = sel && getClip(sel);
    if (c) commit(() => { getClip(c.id).fx = defFx(); });
  });
  const editText = fn => {
    const c = sel && getClip(sel);
    if (c && c.track === 't') commit(() => fn(getClip(c.id)), null);
  };
  $('#txtStr').addEventListener('input', e => {
    const c = sel && getClip(sel);
    if (c && c.track === 't') commit(() => { getClip(c.id).text.str = e.target.value; }, `txt:${c.id}`);
  });
  $('#secText').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.size) editText(c => { c.text.size = b.dataset.size; });
    else if (b.dataset.color) editText(c => { c.text.color = b.dataset.color; });
    else if (b.dataset.pos) editText(c => { const [x, y] = b.dataset.pos.split(',').map(Number); c.text.x = x; c.text.y = y; });
  });
  function timeEdit(which) {
    const c = sel && getClip(sel);
    if (!c || c.track !== 't') return;
    const sIn = $('#txtStart'), eIn = $('#txtEnd');
    const s = parseFloat(sIn.value), e = parseFloat(eIn.value);
    if (!isFinite(s) || !isFinite(e) || s < 0 || e - s < 0.1) {
      toast('ช่วงเวลาไม่ถูกต้อง เวลาจบต้องมากกว่าเวลาเริ่มอย่างน้อย 0.1 วินาที', 'error');
      sIn.value = r3(c.start); eIn.value = r3(c.start + c.dur);
      return;
    }
    commit(() => { const cc = getClip(c.id); cc.start = r3(s); cc.dur = r3(e - s); }, `trange:${c.id}`);
  }
  $('#txtStart').addEventListener('change', () => timeEdit('s'));
  $('#txtEnd').addEventListener('change', () => timeEdit('e'));
  $$('[data-addtext]').forEach(b => b.addEventListener('click', addText));

  /* ---------- แท็บมือถือ ---------- */
  const appEl = $('#app');
  const tabBtns = $$('[data-tab]');
  const mq = window.matchMedia('(max-width:899px)');
  let curTab = 'tl';
  // ใส่ role แท็บเฉพาะมือถือ (จอ ≥900px แท็บถูกซ่อน แผงแสดงพร้อมกันทั้งหมด)
  function applyTabRoles() {
    const m = mq.matches;
    const nav = $('#tabs');
    if (m) nav.setAttribute('role', 'tablist'); else nav.removeAttribute('role');
    tabBtns.forEach(b => {
      const panel = $('#panel-' + b.dataset.tab);
      if (m) {
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(b.dataset.tab === curTab));
        b.tabIndex = b.dataset.tab === curTab ? 0 : -1;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', b.id);
      } else {
        ['role', 'aria-selected'].forEach(a => b.removeAttribute(a));
        b.removeAttribute('tabindex');
        ['role', 'aria-labelledby'].forEach(a => panel.removeAttribute(a));
      }
    });
  }
  function setTab(k, focus) {
    curTab = k;
    appEl.dataset.active = k;
    applyTabRoles();
    if (focus) $('#tab-' + k).focus();
    if (k === 'tl') renderTimeline();
  }
  tabBtns.forEach(b => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (!mq.matches) return;
      const i = tabBtns.indexOf(b);
      let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % tabBtns.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + tabBtns.length) % tabBtns.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = tabBtns.length - 1;
      if (n < 0) return;
      e.preventDefault();
      setTab(tabBtns[n].dataset.tab, true);
    });
  });
  mq.addEventListener('change', applyTabRoles);
  applyTabRoles();

  /* ---------- วาดทั้งหมด ---------- */
  function renderAll() {
    renderLibrary();
    renderTimeline();
    renderInspector();
    updateTransport();
    draw();
    $('#btnUndo').disabled = !undoStack.length;
    $('#btnRedo').disabled = !redoStack.length;
    const pn = $('#projName');
    if (document.activeElement !== pn && pn.value !== P.name) pn.value = P.name;
  }

  /* ---------- ปุ่มและคีย์ลัด ---------- */
  btnPlay.addEventListener('click', togglePlay);
  $('#btnPrev').addEventListener('click', () => stepFrames(-1));
  $('#btnNext').addEventListener('click', () => stepFrames(1));
  $$('[data-rate]').forEach(b => b.addEventListener('click', () => setRate(Number(b.dataset.rate))));
  seek.addEventListener('input', () => setTime(seek.value / 1000 * totalDur()));
  $('#btnCut').addEventListener('click', cutAtPlayhead);
  $('#btnDel').addEventListener('click', deleteSelected);
  $('#btnZoomIn').addEventListener('click', () => setZoom(zoomIdx + 1));
  $('#btnZoomOut').addEventListener('click', () => setZoom(zoomIdx - 1));
  $('#btnUndo').addEventListener('click', doUndo);
  $('#btnRedo').addEventListener('click', doRedo);
  $('#projName').addEventListener('input', e => {
    const v = e.target.value.slice(0, 60);
    commit(() => { P.name = v.trim() ? v : 'โปรเจกต์ไม่มีชื่อ'; }, 'name');
  });
  $('#projName').addEventListener('blur', e => { e.target.value = P.name; });
  $('#projName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  document.addEventListener('keydown', e => {
    const tg = e.target, tag = tg.tagName;
    const typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['range', 'checkbox', 'button'].includes(tg.type)) || tg.isContentEditable;
    if (document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (typing) return;
      if (e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (e.code === 'KeyY') { e.preventDefault(); doRedo(); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    const onRange = tag === 'INPUT' && tg.type === 'range';
    const onBtn = tag === 'BUTTON' || tag === 'A';
    switch (e.code) {
      case 'Space':
        if (onBtn) return;
        e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft': case 'ArrowRight': {
        if (onRange) return;
        e.preventDefault();
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        if (e.altKey) {
          const c = sel && getClip(sel);
          if (c) commit(() => { const cc = getClip(c.id); cc.start = r3(fit(cc, cc.start + dir / FPS)); }, `nudge:${c.id}`);
        } else stepFrames(dir * (e.shiftKey ? FPS : 1));
        break;
      }
      case 'KeyJ': setTime(t - 5); break;
      case 'KeyK': setPlaying(false); break;
      case 'KeyL':
        if (!playing) setPlaying(true);
        else { const rs = [0.5, 1, 1.5, 2]; setRate(rs[Math.min(rs.length - 1, rs.indexOf(rate) + 1)]); }
        break;
      case 'KeyS': cutAtPlayhead(); break;
      case 'Delete': case 'Backspace':
        if (onRange) return;
        e.preventDefault(); deleteSelected(); break;
      default:
    }
  });

  /* ---------- โปรเจกต์: JSON ---------- */
  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function exportJSON() {
    const data = { app: 'noob_dev studio', version: 1, exportedAt: new Date().toISOString(), project: P };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeName(P.name)}.json`);
    toast('ส่งออกไฟล์โปรเจกต์แล้ว ไฟล์วิดีโอต้นฉบับไม่ได้อยู่ในไฟล์นี้นะ');
  }
  async function openJSON(file) {
    try {
      if (file.size > 5 * MB) throw new Error('big');
      const d = JSON.parse(await file.text());
      const np = sanitize(d && d.project ? d.project : d);
      commit(() => { P = np; sel = null; t = 0; });
      toast(np.media.some(m => !isOk(m.id)) ? 'เปิดโปรเจกต์แล้ว เลือกไฟล์ต้นฉบับชื่อเดิมในคลังเพื่อเชื่อมกลับนะ' : 'เปิดโปรเจกต์แล้ว');
    } catch (e) {
      toast('เปิดไฟล์โปรเจกต์ไม่ได้ ไฟล์ต้องเป็น .json ที่ส่งออกจากสตูดิโอนี้และไม่ใหญ่เกิน 5 MB', 'error');
    }
  }
  $('#jsonIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openJSON(f); });
  $('#btnJson').addEventListener('click', exportJSON);

  /* ---------- ส่งออกวิดีโอ ---------- */
  const dlgExport = $('#dlgExport'), dlgHelp = $('#dlgHelp');
  let exp = null, exLinkUrl = '';
  function exportSupport() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      return { ok: false, msg: 'ลองเปิดด้วย Chrome, Edge หรือ Firefox รุ่นล่าสุดนะ งานที่ตัดไว้ยังอยู่ครบ และส่งออกเป็นไฟล์โปรเจกต์ .json เก็บไว้ได้' };
    }
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    if (!mime) return { ok: false, msg: 'เบราว์เซอร์นี้อัดวิดีโอเป็น WebM ไม่ได้ ลองใช้ Chrome, Edge หรือ Firefox รุ่นล่าสุดนะ งานที่ตัดไว้ยังอยู่ครบ' };
    return { ok: true, mime };
  }
  function revokeLink() {
    if (exLinkUrl) { URL.revokeObjectURL(exLinkUrl); exLinkUrl = ''; }
    $('#exLink').hidden = true;
  }
  function setExportBar(p, text) {
    $('#exBar').style.width = p + '%';
    $('#exBarWrap').setAttribute('aria-valuenow', String(Math.round(p)));
    if (text) $('#exPct').textContent = text;
  }
  function setExportUI(running) {
    $('#exStart').disabled = running;
    $('#exCancel').hidden = !running;
    $('#exClose').hidden = running;
    $('#exProj').hidden = running;
  }
  function refreshExportDialog() {
    const tot = totalDur();
    const sup = exportSupport();
    $('#exDur').textContent = fmtTC(tot);
    $('#exWarn').hidden = sup.ok;
    if (!sup.ok) $('#exWarnMsg').textContent = sup.msg;
    $('#exStart').disabled = !sup.ok || !tot;
    $('#exSavedAt').textContent = savedLabel || 'บันทึกอัตโนมัติในเบราว์เซอร์นี้';
    if (!exp || !exp.active) {
      setExportBar(0, !tot ? 'ยังไม่มีคลิปบนไทม์ไลน์ วางคลิปก่อนแล้วค่อยส่งออกนะ' : 'พร้อมส่งออก · ประมวลผลในเครื่องคุณ ไม่มีการอัปโหลดไฟล์');
    }
  }
  function updateExportUI() {
    const tot = totalDur();
    const p = tot ? clamp(t / tot * 100, 0, 99) : 0;
    setExportBar(p, document.hidden ? 'หน้านี้ถูกซ่อนอยู่ การส่งออกจะรอจนกว่าจะกลับมาที่แท็บนี้' : `กำลังส่งออก ${Math.round(p)}% · ${fmtTC(t).slice(0, 8)} / ${fmtTC(tot).slice(0, 8)}`);
  }
  async function startExport() {
    const sup = exportSupport();
    if (!sup.ok) return;
    if (!totalDur()) return;
    if (playing) setPlaying(false);
    revokeLink();
    prepareAudio();
    if (ac && ac.state === 'suspended') { try { await ac.resume(); } catch (e) { /* ข้าม */ } }
    const prevRate = rate;
    setRate(1);
    t = 0; sync(); draw(); updateTransport();
    if (document.fonts && document.fonts.load) { try { await document.fonts.load('700 48px "IBM Plex Sans Thai"'); } catch (e) { /* ข้าม */ } }
    await wait(350);
    let rec, vstream;
    const clones = [];
    try {
      vstream = canvas.captureStream(FPS);
      if (expDest) expDest.stream.getAudioTracks().forEach(tr => { const cl = tr.clone(); clones.push(cl); vstream.addTrack(cl); });
      rec = new MediaRecorder(vstream, { mimeType: sup.mime, videoBitsPerSecond: 6000000 });
    } catch (e) {
      setRate(prevRate);
      setExportBar(0, 'เริ่มส่งออกไม่ได้ เบราว์เซอร์ไม่ยอมเปิดตัวอัดวิดีโอ ลองใหม่อีกครั้งนะ');
      toast('เริ่มส่งออกไม่ได้ เบราว์เซอร์ไม่ยอมเปิดตัวอัดวิดีโอ', 'error');
      return;
    }
    exp = { rec, chunks: [], cancelled: false, failed: false, active: false, prevRate, mime: sup.mime, vstream, clones };
    const me = exp;
    rec.ondataavailable = e => { if (e.data && e.data.size) me.chunks.push(e.data); };
    rec.onerror = () => { me.failed = true; me.active = false; setPlaying(false); try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { /* ข้าม */ } };
    rec.onstop = () => onExportStop(me);
    if (outGain) outGain.gain.value = 0;
    rec.start(500);
    me.active = true;
    setExportUI(true);
    updateExportUI();
    setPlaying(true);
  }
  function finishExport() {
    const me = exp;
    if (!me || !me.active) return;
    me.active = false;
    setExportBar(99, 'กำลังสรุปไฟล์…');
    setTimeout(() => { try { if (me.rec.state !== 'inactive') me.rec.stop(); } catch (e) { /* ข้าม */ } }, 400);
  }
  function cancelExport() {
    const me = exp;
    if (!me) return;
    me.cancelled = true; me.active = false;
    setPlaying(false);
    try { if (me.rec.state !== 'inactive') me.rec.stop(); } catch (e) { /* ข้าม */ }
  }
  function onExportStop(me) {
    if (outGain) outGain.gain.value = 1;
    me.vstream.getTracks().forEach(tr => tr.stop());
    me.clones.forEach(tr => tr.stop());
    setRate(me.prevRate);
    setExportUI(false);
    refreshExportDialog();
    const blob = new Blob(me.chunks, { type: 'video/webm' });
    if (me.cancelled) { setExportBar(0, 'ยกเลิกการส่งออกแล้ว'); }
    else if (me.failed || !blob.size) { setExportBar(0, 'ส่งออกไม่สำเร็จ เบราว์เซอร์อัดวิดีโอไม่ได้ ลองใหม่อีกครั้งนะ'); toast('ส่งออกไม่สำเร็จ ลองใหม่อีกครั้งนะ', 'error'); }
    else {
      const name = `${safeName(P.name)}.webm`;
      exLinkUrl = URL.createObjectURL(blob);
      const a = $('#exLink');
      a.href = exLinkUrl; a.download = name; a.hidden = false;
      setExportBar(100, `ส่งออกเสร็จแล้ว · ${fmtBytes(blob.size)} · ไฟล์ ${name}`);
      $('#exStart').lastChild.textContent = 'ส่งออกอีกครั้ง';
      a.click();
      toast('ส่งออกวิดีโอเสร็จแล้ว');
    }
    exp = null;
    setTime(0);
  }
  $('#btnExport').addEventListener('click', () => { refreshExportDialog(); dlgExport.showModal(); });
  $('#exStart').addEventListener('click', startExport);
  $('#exCancel').addEventListener('click', cancelExport);
  $('#exClose').addEventListener('click', () => dlgExport.close());
  dlgExport.addEventListener('cancel', e => { if (exp && exp.active) e.preventDefault(); });
  dlgExport.addEventListener('close', () => { if (!exp) revokeLink(); });
  $('#exJson').addEventListener('click', exportJSON);
  $('#exOpen').addEventListener('click', () => $('#jsonIn').click());
  $('#exNew').addEventListener('click', () => {
    commit(() => { P = blank(); sel = null; t = 0; });
    toast('เริ่มโปรเจกต์ใหม่แล้ว กด Ctrl+Z เพื่อย้อนกลับได้');
    dlgExport.close();
  });
  $('#btnHelp').addEventListener('click', () => dlgHelp.showModal());
  $('#helpClose').addEventListener('click', () => dlgHelp.close());
  document.addEventListener('visibilitychange', () => { if (exp && exp.active) updateExportUI(); });

  /* ---------- เริ่มทำงาน ---------- */
  window.addEventListener('resize', () => requestAnimationFrame(renderTimeline));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestDraw);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { readOv(); requestDraw(); });

  const restored = loadSaved();
  renderAll();
  if (restored) {
    $('#savedAt').textContent = 'เปิดงานล่าสุดที่บันทึกไว้';
    if (P.media.length) toast('เปิดงานล่าสุดแล้ว ไฟล์ต้นฉบับไม่ได้เก็บไว้ในเบราว์เซอร์ เลือกไฟล์ชื่อเดิมในคลังเพื่อเชื่อมกลับนะ');
  }
})();
