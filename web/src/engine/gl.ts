// WebGL2 compositor: draws cells with cover / contain and framing, applies color grading and 3D LUTs.
import type { CellDraw, FrameDesc } from './frame';
import type { Lut as LutData } from './lut';

const VS = `#version 300 es
in vec2 aPos;
uniform vec4 uQuad; // x,y,w,h in px
uniform vec2 uRes;
out vec2 vPx;
void main() {
  vec2 px = uQuad.xy + aPos * uQuad.zw;
  vPx = px;
  vec2 clip = px / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vPx;
out vec4 outColor;
uniform int uMode; // 0 = media, 1 = solid color
uniform vec4 uColor;
uniform sampler2D uTex;
uniform sampler3D uLut;
uniform float uLutSize;
uniform float uLutMix;
uniform vec4 uCell;    // cell rectangle (for vignette and corner radius)
uniform vec4 uClip;    // visible area
uniform vec4 uContent; // content box (x,y,w,h)
uniform vec3 uBg;
uniform float uAlpha;
uniform float uRadius;
uniform float uExposure, uContrast, uSaturation, uTemp, uTint, uHigh, uShadow, uVignette, uGrain, uTime;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 17.0) * 43758.5453); }
float sdRound(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  if (uMode == 1) { outColor = uColor; return; }
  if (vPx.x < uClip.x || vPx.y < uClip.y || vPx.x > uClip.x + uClip.z || vPx.y > uClip.y + uClip.w) discard;
  float mask = 1.0;
  if (uRadius > 0.5) {
    vec2 c = uCell.xy + uCell.zw * 0.5;
    float d = sdRound(vPx - c, uCell.zw * 0.5, uRadius);
    mask = clamp(0.5 - d, 0.0, 1.0);
    if (mask <= 0.0) discard;
  }
  vec2 uv = (vPx - uContent.xy) / uContent.zw;
  vec3 col;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    col = uBg;
  } else {
    col = texture(uTex, uv).rgb;
    col *= exp2(uExposure);
    col *= vec3(1.0 + 0.12 * uTemp, 1.0 - 0.08 * uTint, 1.0 - 0.12 * uTemp) * vec3(1.0, 1.0, 1.0 + 0.04 * uTint);
    if (uLutMix > 0.0 && uLutSize > 1.0) {
      vec3 c = clamp(col, 0.0, 1.0);
      vec3 lc = c * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
      col = mix(col, texture(uLut, lc).rgb, uLutMix);
    }
    float l = luma(col);
    col += uShadow * 0.3 * (1.0 - smoothstep(0.0, 0.55, l)) * (1.0 - l);
    col += uHigh * 0.3 * smoothstep(0.45, 1.0, l) * l;
    col = (col - 0.45) * (1.0 + uContrast) + 0.45;
    l = luma(col);
    col = mix(vec3(l), col, 1.0 + uSaturation);
    if (uVignette > 0.0) {
      vec2 cu = (vPx - uCell.xy) / uCell.zw - 0.5;
      float d = length(cu * vec2(uCell.z / max(uCell.z, uCell.w), uCell.w / max(uCell.z, uCell.w))) * 1.4142;
      col *= 1.0 - uVignette * smoothstep(0.35, 1.05, d);
    }
    if (uGrain > 0.0) col += (hash(vPx) - 0.5) * 0.12 * uGrain;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), uAlpha * mask);
}`;

export type TexSource = TexImageSource & { width?: number; height?: number };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class Compositor {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null> = {};
  textures = new Map<string, { tex: WebGLTexture; w: number; h: number; src?: unknown; stamp?: number }>();
  luts = new Map<string, { tex: WebGLTexture; size: number }>();
  emptyLut: WebGLTexture;
  time = 0;

  constructor(public canvas: HTMLCanvasElement | OffscreenCanvas, opts: { preserve?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false, antialias: false, preserveDrawingBuffer: !!opts.preserve }) as WebGL2RenderingContext;
    if (!gl) throw new Error('WebGL2 is not supported');
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uQuad', 'uRes', 'uMode', 'uColor', 'uTex', 'uLut', 'uLutSize', 'uLutMix', 'uCell', 'uClip', 'uContent', 'uBg', 'uAlpha', 'uRadius',
      'uExposure', 'uContrast', 'uSaturation', 'uTemp', 'uTint', 'uHigh', 'uShadow', 'uVignette', 'uGrain', 'uTime']) this.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1i(this.u.uLut, 1);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    this.emptyLut = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.emptyLut);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  resize(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  /** Uploads a source to a texture. Skips re-uploading when `stamp` is unchanged (images). */
  upload(key: string, src: TexSource, w: number, h: number, stamp?: number) {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      const tex = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, w, h };
      this.textures.set(key, t);
    }
    if (stamp != null && t.src === src && t.stamp === stamp) return t;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      t.w = w; t.h = h; t.src = src; t.stamp = stamp;
    } catch (e) { console.warn('texture upload failed', key, e); }
    return t;
  }

  drop(key: string) {
    const t = this.textures.get(key);
    if (t) { this.gl.deleteTexture(t.tex); this.textures.delete(key); }
  }

  setLut(id: string, lut: LutData) {
    const gl = this.gl;
    const old = this.luts.get(id);
    if (old) gl.deleteTexture(old.tex);
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    this.luts.set(id, { tex, size: lut.size });
  }

  private quad(x: number, y: number, w: number, h: number) {
    this.gl.uniform4f(this.u.uQuad, x, y, w, h);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private solid(color: string, alpha: number) {
    const [r, g, b] = hexToRgb(color);
    this.gl.uniform1i(this.u.uMode, 1);
    this.gl.uniform4f(this.u.uColor, r, g, b, alpha);
    this.quad(0, 0, this.canvas.width, this.canvas.height);
  }

  /** `getTex(draw)` returns a ready texture (otherwise the cell is filled with its background color). */
  render(frame: FrameDesc, getTex: (d: CellDraw) => { tex: WebGLTexture; w: number; h: number } | null) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    const k = W / frame.W; // preview scale
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, W, H);
    gl.uniform1f(this.u.uTime, (this.time = (this.time + 0.137) % 10));
    const [br, bg, bb] = hexToRgb(frame.background);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const d of frame.draws) {
      const t = getTex(d);
      const cx = d.rect.x + d.rect.w / 2, cy = d.rect.y + d.rect.h / 2;
      // extra scale + offset, around the cell center
      const tr = (x: number, y: number) => [(cx + (x - cx) * d.scale + d.dx) * k, (cy + (y - cy) * d.scale + d.dy) * k];
      const [rx, ry] = tr(d.rect.x, d.rect.y);
      const rw = d.rect.w * d.scale * k, rh = d.rect.h * d.scale * k;
      const [clx, cly] = tr(d.clip.x, d.clip.y);
      const clw = d.clip.w * d.scale * k, clh = d.clip.h * d.scale * k;
      const [cr, cg, cb] = hexToRgb(d.background);
      gl.uniform3f(this.u.uBg, cr, cg, cb);
      gl.uniform4f(this.u.uCell, rx, ry, rw, rh);
      gl.uniform4f(this.u.uClip, clx, cly, clw, clh);
      gl.uniform1f(this.u.uAlpha, d.alpha);
      gl.uniform1f(this.u.uRadius, d.radius * k * d.scale);
      gl.uniform1i(this.u.uMode, 0);
      if (!t) {
        gl.uniform4f(this.u.uContent, -1e5, -1e5, 1, 1); // background only
      } else {
        const sw = t.w, sh = t.h;
        const base = d.cell.fit === 'cover' ? Math.max(rw / sw, rh / sh) : Math.min(rw / sw, rh / sh);
        const s = base * Math.max(0.2, d.framing.zoom);
        const cw = sw * s, ch = sh * s;
        const ox = Math.abs(cw - rw) / 2, oy = Math.abs(ch - rh) / 2;
        const px = rx + rw / 2 - cw / 2 - d.framing.x * ox * Math.sign(cw - rw || 1);
        const py = ry + rh / 2 - ch / 2 - d.framing.y * oy * Math.sign(ch - rh || 1);
        gl.uniform4f(this.u.uContent, px, py, cw, ch);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
      }
      const g = d.grade;
      const lut = g.lut ? this.luts.get(g.lut) : undefined;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lut?.tex ?? this.emptyLut);
      gl.uniform1f(this.u.uLutSize, lut?.size ?? 0);
      gl.uniform1f(this.u.uLutMix, lut ? g.lutMix : 0);
      gl.uniform1f(this.u.uExposure, g.exposure);
      gl.uniform1f(this.u.uContrast, g.contrast);
      gl.uniform1f(this.u.uSaturation, g.saturation);
      gl.uniform1f(this.u.uTemp, g.temperature);
      gl.uniform1f(this.u.uTint, g.tint);
      gl.uniform1f(this.u.uHigh, g.highlights);
      gl.uniform1f(this.u.uShadow, g.shadows);
      gl.uniform1f(this.u.uVignette, g.vignette);
      gl.uniform1f(this.u.uGrain, g.grain);
      this.quad(Math.max(rx, clx), Math.max(ry, cly), Math.min(rx + rw, clx + clw) - Math.max(rx, clx), Math.min(ry + rh, cly + clh) - Math.max(ry, cly));
    }
    for (const o of frame.overlays) if (o.alpha > 0) this.solid(o.color, o.alpha);
  }

  dispose() {
    for (const t of this.textures.values()) this.gl.deleteTexture(t.tex);
    for (const l of this.luts.values()) this.gl.deleteTexture(l.tex);
    this.textures.clear();
    this.luts.clear();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
