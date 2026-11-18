export interface Lut { size: number; data: Float32Array }

/** Adobe / Resolve .cube 3D LUT parser (red is the fastest-changing axis). */
export function parseCube(text: string): Lut {
  let size = 0;
  let min = [0, 0, 0], max = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^LUT_3D_SIZE/i.test(line)) { size = parseInt(line.split(/\s+/)[1]); continue; }
    if (/^DOMAIN_MIN/i.test(line)) { min = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^DOMAIN_MAX/i.test(line)) { max = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^(TITLE|LUT_1D_SIZE|LUT_1D_INPUT_RANGE|LUT_3D_INPUT_RANGE)/i.test(line)) {
      if (/^LUT_1D_SIZE/i.test(line)) throw new Error('1D LUTs are not supported');
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts.length >= 3 && !isNaN(+parts[0])) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('Invalid .cube file');
  const data = new Float32Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    data[i] = (vals[i] - min[c]) / (max[c] - min[c] || 1);
  }
  return { size, data };
}

const cache = new Map<string, Promise<Lut>>();
export function loadLut(path: string) {
  let p = cache.get(path);
  if (!p) {
    p = fetch(`/api/file?path=${encodeURIComponent(path)}`).then((r) => r.text()).then(parseCube);
    cache.set(path, p);
  }
  return p;
}
