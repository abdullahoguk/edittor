import { copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  createProject, fileExists, getRev, listProjects, loadProject, mutateProject, projectDir,
  PROJECTS_DIR, ROOT, saveProject, subscribe, withProject,
} from './store';
import { derivedPath, detectTempo, ensureDerived, importPaths, listDir, pending, probe, waveform } from './media';
import { chatStream, stopChat } from './chat';
import { normalizeProject, uid } from '../shared/project';

const PORT = Number(process.env.PORT ?? 5174);
const DIST = join(ROOT, 'web/dist');

const json = (data: unknown, status = 200) => Response.json(data, { status });
const err = (e: unknown, status = 400) => json({ error: (e as Error).message ?? String(e) }, status);

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.cube': 'text/plain', '.json': 'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
};

/** File response with Range support (needed for video seeking). */
function serveFile(req: Request, path: string, cache = 'no-cache') {
  const file = Bun.file(path);
  const size = file.size;
  const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.get('range');
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m?.[1] ? Number(m[1]) : 0;
    let end = m?.[2] ? Number(m[2]) : size - 1;
    if (!m?.[1] && m?.[2]) { start = size - Number(m[2]); end = size - 1; }
    end = Math.min(end, size - 1);
    return new Response(file.slice(start, end + 1), {
      status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(file, { headers: { ...headers, 'Content-Length': String(size) } });
}

type WS = import('bun').ServerWebSocket<unknown>;
const sockets = new Set<WS>();
subscribe((msg) => { const s = JSON.stringify(msg); sockets.forEach((ws) => ws.send(s)); });

async function route(req: Request, url: URL): Promise<Response> {
  const p = url.pathname;
  const parts = p.split('/').filter(Boolean);

  // --- projects ---
  if (p === '/api/projects' && req.method === 'GET') return json(await listProjects());
  if (p === '/api/projects' && req.method === 'POST') {
    const { name } = await req.json();
    return json(await createProject(name || 'Untitled'));
  }
  if (parts[0] === 'api' && parts[1] === 'projects' && parts[2]) {
    const id = parts[2];
    const sub = parts[3];
    if (!sub && req.method === 'GET') {
      const proj = await loadProject(id);
      ensureDerived(id, proj.pool);
      return json({ project: proj, rev: getRev(id), pending: pending.get(id) ?? 0 });
    }
    if (!sub && req.method === 'PUT') {
      const body = await req.json();
      const proj = normalizeProject(body.project);
      proj.id = id;
      const rev = await withProject(id, () => saveProject(proj, body.origin ?? 'client'));
      return json({ rev });
    }
    if (sub === 'import' && req.method === 'POST') {
      const { paths, origin } = await req.json();
      const r = await importPaths(id, paths, origin);
      return json({ added: r.added });
    }
    if (sub === 'upload' && req.method === 'POST') {
      const form = await req.formData();
      const dir = join(projectDir(id), 'media');
      await mkdir(dir, { recursive: true });
      const saved: string[] = [];
      for (const f of form.getAll('files')) {
        if (!(f instanceof File)) continue;
        const dest = join(dir, basename(f.name));
        await Bun.write(dest, f);
        saved.push(dest);
      }
      const r = await importPaths(id, saved, 'client');
      return json({ added: r.added });
    }
    if (sub === 'luts' && req.method === 'POST') {
      // .cube files: upload or path
      const dir = join(projectDir(id), 'luts');
      await mkdir(dir, { recursive: true });
      let added: { id: string; name: string; path: string }[] = [];
      const ct = req.headers.get('content-type') ?? '';
      if (ct.includes('multipart')) {
        const form = await req.formData();
        for (const f of form.getAll('files')) {
          if (!(f instanceof File)) continue;
          const dest = join(dir, basename(f.name));
          await Bun.write(dest, f);
          added.push({ id: uid('l_'), name: basename(f.name, '.cube'), path: dest });
        }
      } else {
        const { paths } = await req.json();
        for (const src of paths as string[]) {
          const dest = join(dir, basename(src));
          if (resolve(src) !== resolve(dest)) await copyFile(src, dest);
          added.push({ id: uid('l_'), name: basename(src, '.cube'), path: dest });
        }
      }
      await mutateProject(id, 'client', (proj) => {
        const have = new Set(proj.luts.map((l) => l.path));
        proj.luts.push(...added.filter((l) => !have.has(l.path)));
      });
      return json({ added: added.length });
    }
    if (sub === 'waveform') {
      const path = url.searchParams.get('path')!;
      return json(await waveform(id, path));
    }
    if (sub === 'tempo') {
      const path = url.searchParams.get('path')!;
      const from = Number(url.searchParams.get('from') ?? 0);
      return json(await detectTempo(path, from));
    }
    if (sub === 'exports' && req.method === 'POST') {
      const name = (url.searchParams.get('name') ?? 'export').replace(/[^\w.\- ]+/g, '_');
      const dir = join(projectDir(id), 'exports');
      await mkdir(dir, { recursive: true });
      const dest = join(dir, name.endsWith('.mp4') ? name : name + '.mp4');
      const form = await req.formData();
      const video = form.get('video') as File;
      const audio = form.get('audio') as File | null;
      const codec = String(form.get('codec') ?? 'avc');
      const tmpV = dest + '.v.mp4', tmpA = dest + '.a.wav';
      await Bun.write(tmpV, video);
      if (audio) await Bun.write(tmpA, audio);
      const mux = (venc: string[]) => ['ffmpeg', '-v', 'error', '-y', '-i', tmpV, ...(audio ? ['-i', tmpA] : []), '-map', '0:v:0', ...(audio ? ['-map', '1:a:0'] : []),
        ...venc, ...(audio ? ['-c:a', 'aac', '-b:a', '256k', '-shortest'] : []), '-movflags', '+faststart', dest];
      const tries = codec === 'avc' ? [['-c:v', 'copy']]
        : [['-c:v', 'h264_nvenc', '-preset', 'p6', '-cq', '18', '-pix_fmt', 'yuv420p'], ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p']];
      let proc!: ReturnType<typeof Bun.spawn>, code = 1;
      for (const venc of tries) {
        proc = Bun.spawn(mux(venc), { stderr: 'pipe' });
        code = await proc.exited;
        if (code === 0) break;
      }
      const errText = await new Response(proc.stderr as ReadableStream).text();
      await Promise.all([rm(tmpV, { force: true }), rm(tmpA, { force: true })]);
      if (code !== 0) return err(new Error('ffmpeg mux failed: ' + errText.slice(-400)), 500);
      return json({ path: dest, size: Bun.file(dest).size });
    }
    if (sub === 'probe' && req.method === 'POST') {
      const { path } = await req.json();
      return json(await probe(path));
    }
  }

  // --- media ---
  // /media/:projectId/:assetId/:kind   kind = orig | proxy | thumb | strip
  if (parts[0] === 'media' && parts.length === 4) {
    const [, pid, aid, kind] = parts;
    const proj = await loadProject(pid);
    const asset = proj.pool.find((a) => a.id === aid);
    if (!asset) return new Response('not found', { status: 404 });
    if (kind === 'orig') return serveFile(req, asset.path, 'max-age=3600');
    const dp = derivedPath(pid, asset, kind as 'thumb' | 'proxy' | 'strip');
    if (await fileExists(dp)) return serveFile(req, dp, 'max-age=3600');
    if (kind === 'proxy') return serveFile(req, asset.path); // fall back to the original while the proxy is being made
    return new Response('not ready yet', { status: 404 });
  }
  if (p === '/api/file') {
    const path = url.searchParams.get('path')!;
    if (!(await fileExists(path))) return new Response('not found', { status: 404 });
    return serveFile(req, path);
  }
  if (p === '/api/fs') {
    const path = url.searchParams.get('path') || homedir();
    try {
      const l = await listDir(path);
      return json({ ...l, parent: dirname(path) !== path ? dirname(path) : null, home: homedir() });
    } catch (e) { return err(e); }
  }
  if (p === '/api/fonts') {
    // system fonts (fc-list), usable in text layers
    try {
      const out = await new Response(Bun.spawn(['fc-list', ':', 'family'], { stdout: 'pipe' }).stdout).text();
      const fams = [...new Set(out.split('\n').map((l) => l.split(',')[0].trim()).filter(Boolean))].sort();
      return json(fams);
    } catch { return json([]); }
  }

  // --- chat ---
  if (p === '/api/chat' && req.method === 'POST') {
    const body = await req.json();
    const stream = await chatStream(body, PORT);
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  }
  if (p === '/api/chat/stop' && req.method === 'POST') {
    const { projectId } = await req.json();
    stopChat(projectId);
    return json({ ok: true });
  }

  // --- built UI ---
  if (existsSync(DIST)) {
    const f = join(DIST, p === '/' ? 'index.html' : p);
    if (f.startsWith(DIST) && (await fileExists(f))) return serveFile(req, f, p.startsWith('/assets/') ? 'max-age=31536000' : 'no-cache');
    return serveFile(req, join(DIST, 'index.html'));
  }
  return new Response('UI is not built. For development run: bun run dev', { status: 404 });
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  maxRequestBodySize: 1024 * 1024 * 1024 * 8,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return server.upgrade(req) ? undefined : new Response('ws', { status: 400 });
    try { return await route(req, url); } catch (e) { console.error(e); return err(e, 500); }
  },
  websocket: {
    open(ws) { sockets.add(ws); },
    close(ws) { sockets.delete(ws); },
    message() {},
  },
});

console.log(`Edittor server: http://127.0.0.1:${PORT}  ·  projects: ${PROJECTS_DIR}`);
