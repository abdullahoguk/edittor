// Project file schema (project.json). All times are in seconds.
// Scene content is shared; placement (layout, framing, text position) is stored per aspect ratio.

export type FormatId = '9:16' | '4:5' | '1:1' | '16:9' | '4:3' | '2.39:1';

export const FORMATS: Record<FormatId, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: 'Reel / Story' },
  '4:5': { w: 1080, h: 1350, label: 'Instagram dikey' },
  '1:1': { w: 1080, h: 1080, label: 'Kare' },
  '16:9': { w: 1920, h: 1080, label: 'Yatay' },
  '4:3': { w: 1440, h: 1080, label: 'Klasik' },
  '2.39:1': { w: 1920, h: 804, label: 'Sinemaskop' },
};

export type AssetKind = 'video' | 'image' | 'audio';

export interface Grade {
  exposure: number; // -2..2 (EV)
  contrast: number; // -1..1
  saturation: number; // -1..1
  temperature: number; // -1..1 (cool..warm)
  tint: number; // -1..1 (green..magenta)
  highlights: number; // -1..1
  shadows: number; // -1..1
  vignette: number; // 0..1
  grain: number; // 0..1
  lut: string | null; // lut id
  lutMix: number; // 0..1
}

export const DEFAULT_GRADE: Grade = {
  exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0,
  highlights: 0, shadows: 0, vignette: 0, grain: 0, lut: null, lutMix: 1,
};

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  path: string; // absolute path
  width: number; // display size (rotation applied)
  height: number;
  duration: number; // 0 for images
  hasAudio: boolean;
  grade: Grade;
  addedAt: number;
}

export interface Lut {
  id: string;
  name: string;
  path: string;
}

export type FitMode = 'cover' | 'contain';
export type MotionKind = 'none' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export type CellEnter = 'cut' | 'fade' | 'slide-up' | 'slide-down' | 'slide-left' | 'slide-right' | 'wipe' | 'zoom';

export interface Framing {
  x: number; // -1..1 pan (within the overflow when covering)
  y: number;
  zoom: number; // 1 = exact fit
}

export interface Cell {
  id: string;
  assetId: string | null;
  fit: FitMode;
  in: number; // source in-point of the video (slip)
  speed: number; // 1 = normal
  volume: number; // 0..1, video audio (default 0)
  enterDelay: number; // when the cell appears within the scene
  enter: CellEnter;
  motion: MotionKind;
  motionAmount: number; // 0..1
  framing: Partial<Record<FormatId, Framing>>;
}

export type TransitionKind = 'cut' | 'fade' | 'black' | 'white' | 'slide-left' | 'slide-up' | 'zoom' | 'blur';

export interface SceneLayout {
  preset: string; // id from layouts.ts
  weights: number[]; // relative size of each cell along the main axis
  gap: number; // px (1080 reference)
  padding: number; // px
  radius: number; // px
}

export interface Scene {
  id: string;
  name?: string;
  duration: number;
  cellCount: number; // 1..4
  cells: Cell[];
  layouts: Partial<Record<FormatId, SceneLayout>>;
  transition: { kind: TransitionKind; duration: number }; // transition into this scene
  background?: string;
}

export type TextAnimIn =
  | 'none' | 'fade' | 'rise' | 'drop' | 'mask-up' | 'letters' | 'words' | 'typewriter' | 'blur' | 'scale' | 'tracking';
export type TextAnimOut = 'none' | 'fade' | 'rise' | 'drop' | 'mask-down' | 'blur' | 'scale';

export interface TextBox {
  x: number; // 0..1 center
  y: number; // 0..1 center
  width: number; // 0..1 max width
  size: number; // px (short side = 1080 reference)
  align: 'left' | 'center' | 'right';
}

export interface TextLayer {
  id: string;
  text: string;
  start: number;
  duration: number;
  track: number; // 0..n text track
  font: string;
  weight: number;
  italic: boolean;
  uppercase: boolean;
  color: string;
  opacity: number;
  letterSpacing: number; // em
  lineHeight: number;
  shadow: number; // 0..1
  background: string | null; // box color
  animIn: TextAnimIn;
  animOut: TextAnimOut;
  animDuration: number; // in-animation duration (s)
  stagger: number; // delay between letters / words (s)
  layouts: Partial<Record<FormatId, TextBox>>;
}

export interface Music {
  path: string;
  name: string;
  offset: number; // start position within the music file (s)
  volume: number;
  fadeIn: number;
  fadeOut: number;
  duration: number; // file duration
}

export interface Tempo {
  bpm: number; // 0 = no beat grid
  offset: number; // timeline time of the first beat (s)
  snap: boolean;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  formats: FormatId[];
  activeFormat: FormatId;
  fps: number;
  background: string;
  fadeIn: number;
  fadeOut: number;
  pool: Asset[];
  luts: Lut[];
  music: Music | null;
  tempo: Tempo;
  scenes: Scene[];
  texts: TextLayer[];
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  scenes: number;
  duration: number;
  cover: string | null;
}
