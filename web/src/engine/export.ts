// Export: runs the same compositor frame by frame on the original files and encodes MP4 with WebCodecs (mediabunny).
import {
  ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, UrlSource,
  type WrappedCanvas,
} from 'mediabunny';
import { sceneStarts, totalDuration } from '../../../shared/project';
import { FORMATS, type Asset, type FormatId, type Project } from '../../../shared/types';
import { fileUrl, mediaUrl } from '../store/editor';
import { evaluateFrame, type CellDraw } from './frame';
import { Compositor } from './gl';
import { loadLut } from './lut';
import { drawText } from './text';
import { ensureFont } from '../lib/fonts';

export interface ExportOptions {
  format: FormatId;
  scale: number; // 1 = full resolution
  fps: number;
  bitrate: number; // bps
  source: 'orig' | 'proxy';
  range?: [number, number];
}

export interface ExportProgress { frame: number; frames: number; phase: string }

class VideoReader {
  iter: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  cur: WrappedCanvas | null = null;
  next: WrappedCanvas | null = null;
  done = false;
  private constructor(public sink: CanvasSink, public start: number) {}

  static async open(url: string, start: number, maxSide: number) {
    const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(url) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('No video track: ' + url);
    const w = track.displayWidth, h = track.displayHeight;
    const k = Math.min(1, maxSide / Math.max(w, h));
    const sink = new CanvasSink(track, { width: Math.round((w * k) / 2) * 2, height: Math.round((h * k) / 2) * 2, fit: 'fill', poolSize: 4 });
    const r = new VideoReader(sink, start);
    r.iter = sink.canvases(start) as AsyncGenerator<WrappedCanvas | null, void, unknown>;
    return r;
  }

  /** The frame to show at time t. */
  async at(t: number) {
    if (!this.cur) this.cur = await this.pull();
    for (;;) {
      if (!this.next) this.next = await this.pull();
      if (!this.next || this.next.timestamp > t + 1e-4) break;
      this.cur = this.next;
      this.next = null;
    }
    return this.cur;
  }

  private async pull() {
    if (this.done || !this.iter) return null;
    const r = await this.iter.next();
    if (r.done) { this.done = true; return null; }
    return r.value ?? null;
  }

  async close() { await this.iter?.return(undefined); }
}

async function loadBitmap(url: string, maxSide: number) {
  const blob = await (await fetch(url)).blob();
  const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(probe.width, probe.height));
  if (k >= 1) return probe;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: Math.round(probe.width * k), resizeHeight: Math.round(probe.height * k), resizeQuality: 'high' });
  probe.close();
  return bmp;
}

async function renderAudio(p: Project, t0: number, t1: number, onPhase: (s: string) => void): Promise<AudioBuffer | null> {
  const rate = 48000;
  const len = Math.ceil((t1 - t0) * rate);
  const ctx = new OfflineAudioContext(2, Math.max(1, len), rate);
  let any = false;
  const total = totalDuration(p);
  const decode = async (url: string) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  if (p.music) {
    onPhase('müzik çözülüyor');
    const buf = await decode(fileUrl(p.music.path));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const m = p.music;
    const vol = m.volume;
    // envelope: timeline time -> context time (t - t0)
    const at = (t: number) => Math.max(0, t - t0);
    g.gain.setValueAtTime(m.fadeIn > 0 && t0 < m.fadeIn ? vol * (t0 / m.fadeIn) : vol, 0);
    if (m.fadeIn > 0 && t0 < m.fadeIn) g.gain.linearRampToValueAtTime(vol, at(m.fadeIn));
    if (m.fadeOut > 0) {
      const fs = Math.max(t0, total - m.fadeOut);
      g.gain.setValueAtTime(vol, at(fs));
      g.gain.linearRampToValueAtTime(0.0001, at(total));
    }
    src.connect(g).connect(ctx.destination);
    src.start(0, m.offset + t0);
    any = true;
  }
  const starts = sceneStarts(p);
  const assets = new Map(p.pool.map((a) => [a.id, a]));
  for (let i = 0; i < p.scenes.length; i++) {
    const s = p.scenes[i];
    for (const c of s.cells) {
      const a = c.assetId ? assets.get(c.assetId) : undefined;
      if (!a || a.kind !== 'video' || !a.hasAudio || c.volume <= 0) continue;
      const cs = starts[i] + c.enterDelay, ce = starts[i] + s.duration;
      if (ce <= t0 || cs >= t1) continue;
      try {
        onPhase('video sesi');
        const buf = await decode(mediaUrl(p.id, a, 'orig'));
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = c.speed;
        const g = ctx.createGain();
        g.gain.value = c.volume;
        src.connect(g).connect(ctx.destination);
        const skip = Math.max(0, t0 - cs);
        src.start(Math.max(0, cs - t0), c.in + skip * c.speed, (ce - Math.max(cs, t0)) * c.speed);
        any = true;
      } catch (e) { console.warn('could not decode audio', a.name, e); }
    }
  }
  if (!any) return null;
  onPhase('ses karıştırılıyor');
  return ctx.startRendering();
}

function wav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

export interface ExportResult { video: Blob; codec: 'avc' | 'vp9'; audio: Blob | null }

/** Encodes video and returns audio as WAV; the server muxes it to AAC with ffmpeg (Linux Chromium has no AAC encoder). */
export async function exportVideo(p: Project, opt: ExportOptions, onProgress: (x: ExportProgress) => void, signal: AbortSignal): Promise<ExportResult> {
  const base = FORMATS[opt.format];
  const W = Math.round((base.w * opt.scale) / 2) * 2;
  const H = Math.round((base.h * opt.scale) / 2) * 2;
  const [t0, t1] = opt.range ?? [0, totalDuration(p)];
  const frames = Math.max(1, Math.round((t1 - t0) * opt.fps));

  // Canvases: WebGL media + 2D composited output
  const glCanvas = document.createElement('canvas');
  glCanvas.width = W; glCanvas.height = H;
  const comp = new Compositor(glCanvas, { preserve: true });
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { alpha: false })!;

  onProgress({ frame: 0, frames, phase: 'hazırlanıyor' });
  for (const l of p.luts) {
    try { comp.setLut(l.id, await loadLut(l.path)); } catch (e) { console.warn('LUT', e); }
  }
  for (const t of p.texts) await ensureFont(t.font, t.weight, t.italic);
  await document.fonts.ready;

  const audio = await renderAudio(p, t0, t1, (phase) => onProgress({ frame: 0, frames, phase }));

  const avcOk = (await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: W, height: H, bitrate: opt.bitrate })).supported;
  const codec = avcOk ? 'avc' : 'vp9';
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(out, { codec, bitrate: opt.bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: opt.fps });
  await output.start();

  const readers = new Map<string, Promise<VideoReader>>();
  const bitmaps = new Map<string, Promise<ImageBitmap>>();
  const maxSide = Math.max(W, H) * 1.6;
  const urlFor = (a: Asset) => mediaUrl(p.id, a, opt.source === 'orig' ? 'orig' : 'proxy');

  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = t0 + i / opt.fps;
      const frame = evaluateFrame(p, opt.format, t, W, H);
      const ready = new Map<string, { tex: WebGLTexture; w: number; h: number }>();
      const used = new Set<string>();
      for (const d of frame.draws) {
        if (d.asset.kind === 'image') {
          const key = 'i:' + d.asset.id;
          if (!bitmaps.has(key)) bitmaps.set(key, loadBitmap(urlFor(d.asset), maxSide));
          const bmp = await bitmaps.get(key)!;
          ready.set(d.key, comp.upload(key, bmp, bmp.width, bmp.height, 1));
        } else {
          used.add(d.key);
          if (!readers.has(d.key)) readers.set(d.key, VideoReader.open(urlFor(d.asset), d.srcTime, maxSide));
          const r = await readers.get(d.key)!;
          const c = await r.at(d.srcTime);
          if (c) ready.set(d.key, comp.upload('v:' + d.key, c.canvas as HTMLCanvasElement, c.canvas.width, c.canvas.height));
        }
      }
      // close readers that are no longer needed
      for (const [k, r] of readers) if (!used.has(k)) { readers.delete(k); r.then((x) => x.close()); comp.drop('v:' + k); }

      comp.render(frame, (d: CellDraw) => ready.get(d.key) ?? null);
      ctx.drawImage(glCanvas, 0, 0);
      for (const { layer, local } of frame.texts) drawText(ctx, layer, local, opt.format, W, H);
      await vsrc.add(i / opt.fps, 1 / opt.fps);
      if (i % 3 === 0) onProgress({ frame: i + 1, frames, phase: 'kodlanıyor' });
    }
    onProgress({ frame: frames, frames, phase: 'paketleniyor' });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const r of readers.values()) r.then((x) => x.close()).catch(() => {});
    for (const b of bitmaps.values()) b.then((x) => x.close()).catch(() => {});
    comp.dispose();
  }
  return { video: new Blob([output.target.buffer!], { type: 'video/mp4' }), codec, audio: audio ? wav(audio) : null };
}
