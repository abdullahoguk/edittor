import { mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { DEFAULT_GRADE, type Asset, type AssetKind } from '../shared/types';
import { broadcast, cacheDir, mutateProject, projectDir } from './store';

const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts']);
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.avif', '.heic']);
const AUDIO = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']);

export function kindOf(path: string): AssetKind | null {
  const e = extname(path).toLowerCase();
  if (VIDEO.has(e)) return 'video';
  if (IMAGE.has(e)) return 'image';
  if (AUDIO.has(e)) return 'audio';
  return null;
}

async function run(cmd: string[], opts: { stdout?: 'pipe' } = {}) {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`${cmd[0]} failed (${code}): ${err.slice(-600)}`);
  return Buffer.from(out);
}

// ---------- file browser ----------

export async function listDir(path: string) {
  const entries = await readdir(path, { withFileTypes: true });
  const dirs: string[] = [];
  const files: { name: string; kind: AssetKind; size: number }[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile()) {
      const k = kindOf(e.name);
      if (k) files.push({ name: e.name, kind: k, size: (await stat(join(path, e.name))).size });
    }
  }
  dirs.sort((a, b) => a.localeCompare(b, 'tr'));
  files.sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));
  return { path, dirs, files };
}

async function expandPaths(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const s = await stat(p).catch(() => null);
    if (!s) continue;
    if (s.isDirectory()) {
      const l = await listDir(p);
      out.push(...l.files.map((f) => join(p, f.name)));
    } else if (kindOf(p)) out.push(p);
  }
  return out;
}

// ---------- probe ----------

export async function probe(path: string): Promise<Omit<Asset, 'id' | 'grade' | 'addedAt'>> {
  const kind = kindOf(path)!;
  const name = basename(path);
  if (kind === 'image') {
    const m = await sharp(path).metadata();
    const rot = (m.orientation ?? 1) >= 5;
    return { kind, name, path, width: rot ? m.height! : m.width!, height: rot ? m.width! : m.height!, duration: 0, hasAudio: false };
  }
  const json = JSON.parse((await run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path])).toString());
  const v = json.streams.find((s: any) => s.codec_type === 'video');
  const a = json.streams.find((s: any) => s.codec_type === 'audio');
  let w = v?.width ?? 0, h = v?.height ?? 0;
  const rot = Number(v?.side_data_list?.find((d: any) => d.rotation != null)?.rotation ?? v?.tags?.rotate ?? 0);
  if (Math.abs(rot) % 180 === 90) [w, h] = [h, w];
  return { kind, name, path, width: w, height: h, duration: Number(json.format.duration ?? 0), hasAudio: !!a };
}

const assetIdFor = (path: string) => 'a_' + createHash('sha1').update(path).digest('hex').slice(0, 10);

export async function importPaths(projectId: string, paths: string[], origin = 'server') {
  const files = await expandPaths(paths);
  const probed: Asset[] = [];
  for (const f of files) {
    try {
      probed.push({ ...(await probe(f)), id: assetIdFor(f), grade: { ...DEFAULT_GRADE }, addedAt: Date.now() });
    } catch (e) { console.warn('probe', f, (e as Error).message); }
  }
  const { project } = await mutateProject(projectId, origin, (p) => {
    const have = new Set(p.pool.map((a) => a.id));
    p.pool.push(...probed.filter((a) => !have.has(a.id)));
  });
  for (const a of probed) enqueue(projectId, a);
  return { added: probed.length, project };
}

// ---------- derived files (thumb / proxy / strip) ----------

let encoderP: Promise<string[]> | null = null;
function videoEncoder() { return (encoderP ??= pickEncoder()); }
async function pickEncoder() {
  let encoder: string[];
  try {
    await run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2', '-c:v', 'h264_nvenc', '-f', 'null', '-']);
    encoder = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '27', '-g', '12', '-bf', '0'];
  } catch {
    encoder = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-g', '12', '-bf', '0'];
  }
  console.log('[proxy] encoder:', encoder[1]);
  return encoder;
}

type Job = { projectId: string; asset: Asset };
const queue: Job[] = [];
let running = 0;
const MAX_JOBS = 2;
export const pending = new Map<string, number>();

function enqueue(projectId: string, asset: Asset) {
  if (asset.kind === 'audio') return;
  const dir = cacheDir(projectId, asset.id);
  if (existsSync(join(dir, 'done'))) return;
  queue.push({ projectId, asset });
  pending.set(projectId, (pending.get(projectId) ?? 0) + 1);
  pump();
}

function pump() {
  while (running < MAX_JOBS && queue.length) {
    const job = queue.shift()!;
    running++;
    derive(job).catch((e) => console.warn('[proxy]', job.asset.name, e.message)).finally(() => {
      running--;
      pending.set(job.projectId, Math.max(0, (pending.get(job.projectId) ?? 1) - 1));
      broadcast({ type: 'asset-ready', id: job.projectId, assetId: job.asset.id, pending: pending.get(job.projectId) });
      pump();
    });
  }
}

export async function ensureDerived(projectId: string, assets: Asset[]) {
  for (const a of assets) enqueue(projectId, a);
}

async function derive({ projectId, asset }: Job) {
  const dir = cacheDir(projectId, asset.id);
  await mkdir(dir, { recursive: true });
  if (asset.kind === 'image') {
    const img = sharp(asset.path, { failOn: 'none' }).rotate();
    await img.clone().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(join(dir, 'proxy.jpg'));
    await img.clone().resize(360, 360, { fit: 'inside' }).jpeg({ quality: 78 }).toFile(join(dir, 'thumb.jpg'));
  } else {
    const t = Math.min(1, asset.duration / 2);
    await run(['ffmpeg', '-v', 'error', '-y', '-ss', String(t), '-i', asset.path, '-frames:v', '1', '-vf', 'scale=360:360:force_original_aspect_ratio=decrease', '-q:v', '4', join(dir, 'thumb.jpg')]);
    const n = 12;
    await run(['ffmpeg', '-v', 'error', '-y', '-i', asset.path, '-vf', `fps=${n}/${Math.max(0.5, asset.duration)},scale=-2:100,tile=${n}x1`, '-frames:v', '1', '-q:v', '5', join(dir, 'strip.jpg')]);
    const enc = await videoEncoder();
    await run([
      'ffmpeg', '-v', 'error', '-y', '-i', asset.path,
      '-vf', 'scale=w=1280:h=1280:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p',
      ...enc, ...(asset.hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-movflags', '+faststart', join(dir, 'proxy.mp4'),
    ]);
  }
  await writeFile(join(dir, 'done'), String(Date.now()));
}

export function derivedPath(projectId: string, asset: Asset, kind: 'thumb' | 'proxy' | 'strip') {
  const dir = cacheDir(projectId, asset.id);
  if (kind === 'thumb') return join(dir, 'thumb.jpg');
  if (kind === 'strip') return join(dir, 'strip.jpg');
  return join(dir, asset.kind === 'image' ? 'proxy.jpg' : 'proxy.mp4');
}

// ---------- music analysis ----------

async function pcm(path: string, rate: number) {
  const buf = await run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-']);
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

export async function waveform(projectId: string, path: string) {
  const key = createHash('sha1').update(path).digest('hex').slice(0, 10);
  const f = join(projectDir(projectId), '.cache', `wave-${key}.json`);
  if (existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
  const rate = 8000, perSec = 100, hop = rate / perSec;
  const s = await pcm(path, rate);
  const peaks: number[] = [];
  for (let i = 0; i < s.length; i += hop) {
    let m = 0;
    for (let j = i; j < Math.min(s.length, i + hop); j++) m = Math.max(m, Math.abs(s[j]));
    peaks.push(+(m / 32768).toFixed(3));
  }
  const out = { perSec, peaks };
  await mkdir(join(projectDir(projectId), '.cache'), { recursive: true });
  await writeFile(f, JSON.stringify(out));
  return out;
}

/** Simple tempo estimate: energy flux + autocorrelation. firstBeat = first strong beat in the file (s). */
export async function detectTempo(path: string, from = 0, length = 60) {
  const rate = 11025, hop = 128;
  const all = await pcm(path, rate);
  const s = all.subarray(Math.floor(from * rate), Math.floor((from + length) * rate));
  const frames = Math.floor(s.length / hop);
  const env = new Float32Array(frames);
  let prev = 0;
  for (let i = 0; i < frames; i++) {
    let e = 0;
    for (let j = 0; j < hop; j++) { const v = s[i * hop + j] / 32768; e += v * v; }
    e = Math.log1p(1000 * e);
    env[i] = Math.max(0, e - prev);
    prev = e;
  }
  const fps = rate / hop;
  let best = 0, bestLag = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * fps;
    let sum = 0;
    for (let i = 0; i + lag * 4 < frames; i++) {
      const l = Math.round(lag);
      sum += env[i] * (env[i + l] + 0.5 * env[i + 2 * l] + 0.25 * env[Math.round(i + 4 * lag)]);
    }
    // gently prefer tempos close to human perception (≈120)
    sum *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.2, 2));
    if (sum > best) { best = sum; bestLag = lag; }
  }
  const bpm = +(60 / (bestLag / fps)).toFixed(2);
  // phase: find the strongest beat sequence
  let bestPhase = 0, bestScore = -1;
  const L = bestLag;
  for (let ph = 0; ph < L; ph++) {
    let sc = 0;
    for (let k = ph; k < frames; k += L) sc += env[Math.round(k)] ?? 0;
    if (sc > bestScore) { bestScore = sc; bestPhase = ph; }
  }
  return { bpm, firstBeat: +(from + bestPhase / fps).toFixed(3) };
}
