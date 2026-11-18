// Preview player: syncs proxy videos, images and music, and runs the compositor every frame.
import { totalDuration } from '../../../shared/project';
import { FORMATS, type Asset, type Project } from '../../../shared/types';
import { useEditor, mediaUrl, fileUrl } from '../store/editor';
import { evaluateFrame, upcomingVideoKeys, type CellDraw } from './frame';
import { Compositor } from './gl';
import { loadLut } from './lut';
import { drawText } from './text';
import { ensureFont } from '../lib/fonts';

interface Slot { video: HTMLVideoElement; assetId: string; lastUsed: number; seeking: boolean; target: number }

export class Player {
  comp: Compositor;
  ctx: CanvasRenderingContext2D;
  slots = new Map<string, Slot>();
  images = new Map<string, { img: HTMLImageElement; ready: boolean; ver: number }>();
  music: HTMLAudioElement = new Audio();
  musicPath = '';
  lutsLoaded = new Set<string>();
  raf = 0;
  playStartT = 0;
  playStartNow = 0;
  dirty = true;
  unsub: () => void;
  size = { w: 0, h: 0 };

  constructor(public glCanvas: HTMLCanvasElement, public textCanvas: HTMLCanvasElement) {
    this.comp = new Compositor(glCanvas);
    this.ctx = textCanvas.getContext('2d')!;
    this.music.preload = 'auto';
    this.unsub = useEditor.subscribe((s, prev) => {
      if (s.playing !== prev.playing) s.playing ? this.startPlay() : this.stopPlay();
      if (s.project !== prev.project || s.time !== prev.time || s.mediaVer !== prev.mediaVer) this.dirty = true;
      if (s.mediaVer !== prev.mediaVer) for (const [id, v] of Object.entries(s.mediaVer)) if (prev.mediaVer[id] !== v) this.images.delete(id);
    });
    document.fonts.addEventListener('loadingdone', () => { this.dirty = true; });
    this.raf = requestAnimationFrame(this.tick);
  }

  setSize(w: number, h: number) {
    this.size = { w, h };
    this.comp.resize(w, h);
    if (this.textCanvas.width !== w) this.textCanvas.width = w;
    if (this.textCanvas.height !== h) this.textCanvas.height = h;
    this.dirty = true;
  }

  private startPlay() {
    const { time, project } = useEditor.getState();
    if (project && time >= totalDuration(project) - 0.05) useEditor.setState({ time: 0 });
    this.playStartT = useEditor.getState().time;
    this.playStartNow = performance.now();
    this.syncMusic(true);
  }

  private stopPlay() {
    this.music.pause();
    for (const s of this.slots.values()) s.video.pause();
    this.dirty = true;
  }

  private syncMusic(force = false) {
    const { project: p, time, playing } = useEditor.getState();
    const m = p?.music;
    if (!m) { this.music.pause(); return; }
    if (this.musicPath !== m.path) { this.musicPath = m.path; this.music.src = fileUrl(m.path); }
    if (!playing) return;
    const target = m.offset + time;
    if (target >= m.duration) { this.music.pause(); return; }
    if (force || Math.abs(this.music.currentTime - target) > 0.12) this.music.currentTime = target;
    const total = totalDuration(p!);
    let v = m.volume;
    if (m.fadeIn > 0) v *= Math.min(1, time / m.fadeIn);
    if (m.fadeOut > 0) v *= Math.min(1, Math.max(0, (total - time) / m.fadeOut));
    this.music.volume = Math.max(0, Math.min(1, v));
    if (this.music.paused) this.music.play().catch(() => {});
  }

  private image(p: Project, a: Asset) {
    const ver = useEditor.getState().mediaVer[a.id] ?? 0;
    let e = this.images.get(a.id);
    if (!e || e.ver !== ver) {
      const img = new Image();
      img.decoding = 'async';
      const entry = { img, ready: false, ver };
      img.onload = () => { entry.ready = true; this.dirty = true; };
      img.src = mediaUrl(p.id, a, 'proxy', ver);
      this.images.set(a.id, entry);
      e = entry;
    }
    return e.ready ? e.img : null;
  }

  private slot(p: Project, key: string, a: Asset): Slot {
    let s = this.slots.get(key);
    if (s && s.assetId !== a.id) { this.freeSlot(key); s = undefined; }
    if (!s) {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.crossOrigin = 'anonymous';
      v.src = mediaUrl(p.id, a, 'proxy', useEditor.getState().mediaVer[a.id]);
      const slot: Slot = { video: v, assetId: a.id, lastUsed: performance.now(), seeking: false, target: -1 };
      v.addEventListener('seeked', () => { slot.seeking = false; this.dirty = true; });
      v.addEventListener('loadeddata', () => { this.dirty = true; });
      this.slots.set(key, slot);
      s = slot;
    }
    s.lastUsed = performance.now();
    return s;
  }

  private freeSlot(key: string) {
    const s = this.slots.get(key);
    if (!s) return;
    s.video.pause();
    s.video.removeAttribute('src');
    s.video.load();
    this.comp.drop('v:' + key);
    this.slots.delete(key);
  }

  private seek(s: Slot, t: number) {
    if (s.seeking && Math.abs(s.target - t) < 0.02) return;
    s.target = t;
    s.seeking = true;
    if ('fastSeek' in s.video && useEditor.getState().playing === false && Math.abs(s.video.currentTime - t) > 2) {
      s.video.currentTime = t;
    } else s.video.currentTime = t;
  }

  private ensureLuts(p: Project) {
    for (const l of p.luts) {
      if (this.lutsLoaded.has(l.id)) continue;
      this.lutsLoaded.add(l.id);
      loadLut(l.path).then((lut) => { this.comp.setLut(l.id, lut); this.dirty = true; }).catch((e) => console.warn('LUT', l.name, e));
    }
  }

  private tick = () => {
    this.raf = requestAnimationFrame(this.tick);
    const st = useEditor.getState();
    const p = st.project;
    if (!p || !this.size.w) return;
    if (st.playing) {
      const t = this.playStartT + (performance.now() - this.playStartNow) / 1000;
      const total = totalDuration(p);
      if (t >= total) { useEditor.setState({ playing: false, time: Math.max(0, total - 0.001) }); return; }
      useEditor.setState({ time: t });
      this.syncMusic();
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.render(p, st.time, st.playing);
  };

  private render(p: Project, t: number, playing: boolean) {
    this.ensureLuts(p);
    const f = p.activeFormat;
    const { w: FW, h: FH } = FORMATS[f];
    const frame = evaluateFrame(p, f, t, FW, FH);
    const active = new Set(frame.draws.map((d) => d.key));

    // sync videos and preload the upcoming ones
    for (const u of upcomingVideoKeys(p, t)) {
      const s = this.slot(p, u.key, u.asset);
      const isActive = active.has(u.key);
      const v = s.video;
      v.muted = u.cell.volume <= 0 || !playing;
      v.volume = Math.min(1, u.cell.volume);
      if (isActive) {
        const d = frame.draws.find((x) => x.key === u.key)!;
        if (playing) {
          v.playbackRate = u.cell.speed;
          if (v.paused) { v.currentTime = d.srcTime; v.play().catch(() => {}); }
          else if (Math.abs(v.currentTime - d.srcTime) > 0.3) v.currentTime = d.srcTime;
        } else {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - d.srcTime) > 0.5 / p.fps) this.seek(s, d.srcTime);
        }
      } else {
        if (!v.paused) v.pause();
        const pre = u.cell.in;
        if (Math.abs(v.currentTime - pre) > 0.05 && !s.seeking) this.seek(s, pre);
      }
    }
    // release unused sources
    const now = performance.now();
    for (const [k, s] of this.slots) if (!active.has(k) && now - s.lastUsed > 4000) this.freeSlot(k);

    const k = this.size.w / FW;
    this.comp.render(frame, (d: CellDraw) => {
      if (d.asset.kind === 'image') {
        const img = this.image(p, d.asset);
        if (!img) return null;
        return this.comp.upload('i:' + d.asset.id, img, img.naturalWidth, img.naturalHeight, 1);
      }
      const s = this.slots.get(d.key);
      if (!s || s.video.readyState < 2) return null;
      return this.comp.upload('v:' + d.key, s.video, s.video.videoWidth, s.video.videoHeight);
    });
    if (playing && frame.draws.some((d) => d.asset.kind === 'video')) this.dirty = true;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const { layer, local } of frame.texts) {
      ensureFont(layer.font, layer.weight, layer.italic);
      drawText(ctx, layer, local, f, FW, FH);
    }
  }

  invalidate() { this.dirty = true; }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    for (const k of [...this.slots.keys()]) this.freeSlot(k);
    this.music.pause();
    this.comp.dispose();
  }
}
