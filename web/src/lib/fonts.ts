import type { TextLayer } from '../../../shared/types';

export const FONT_GROUPS: { label: string; fonts: string[] }[] = [
  { label: 'Grotesk / Swiss', fonts: ['Inter Tight', 'Inter', 'Archivo', 'Archivo Narrow', 'Schibsted Grotesk', 'Hanken Grotesk', 'Instrument Sans', 'Space Grotesk', 'Unbounded', 'Bebas Neue'] },
  { label: 'Serif', fonts: ['Instrument Serif', 'Playfair Display', 'Cormorant Garamond', 'EB Garamond', 'DM Serif Display', 'Fraunces', 'Newsreader', 'Libre Caslon Text'] },
  { label: 'Mono', fonts: ['IBM Plex Mono', 'JetBrains Mono'] },
];

export type TextPreset = { id: string; name: string; sample: string; style: Partial<TextLayer>; size: number; align: 'left' | 'center' | 'right' };

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'swiss-title', name: 'Swiss başlık', sample: 'Korugöl', size: 120, align: 'left',
    style: { font: 'Inter Tight', weight: 700, italic: false, uppercase: false, letterSpacing: -0.04, lineHeight: 0.95, animIn: 'mask-up', animOut: 'fade', animDuration: 0.7, stagger: 0.08 } },
  { id: 'swiss-label', name: 'Swiss etiket', sample: 'DÜZCE — KASIM 2026', size: 30, align: 'left',
    style: { font: 'Inter Tight', weight: 500, italic: false, uppercase: true, letterSpacing: 0.14, lineHeight: 1.2, animIn: 'fade', animOut: 'fade', animDuration: 0.5 } },
  { id: 'grotesk-heavy', name: 'Ağır grotesk', sample: 'YELLOW SHADES', size: 130, align: 'center',
    style: { font: 'Archivo', weight: 900, italic: false, uppercase: true, letterSpacing: -0.03, lineHeight: 0.9, animIn: 'words', animOut: 'rise', animDuration: 0.5, stagger: 0.09 } },
  { id: 'editorial-serif', name: 'Editoryal serif', sample: 'yellow shades', size: 140, align: 'center',
    style: { font: 'Instrument Serif', weight: 400, italic: true, uppercase: false, letterSpacing: -0.01, lineHeight: 1, animIn: 'blur', animOut: 'blur', animDuration: 0.9 } },
  { id: 'classic-serif', name: 'Klasik serif', sample: 'Sonbahar', size: 110, align: 'center',
    style: { font: 'Cormorant Garamond', weight: 500, italic: false, uppercase: false, letterSpacing: 0.02, lineHeight: 1.05, animIn: 'letters', animOut: 'fade', animDuration: 0.6, stagger: 0.04 } },
  { id: 'display-serif', name: 'Gösteriş serif', sample: 'Göl', size: 180, align: 'center',
    style: { font: 'Playfair Display', weight: 700, italic: true, uppercase: false, letterSpacing: -0.02, lineHeight: 0.95, animIn: 'scale', animOut: 'fade', animDuration: 0.8 } },
  { id: 'condensed', name: 'Dar başlık', sample: 'NOVEMBER', size: 200, align: 'center',
    style: { font: 'Bebas Neue', weight: 400, italic: false, uppercase: true, letterSpacing: 0.04, lineHeight: 0.9, animIn: 'tracking', animOut: 'fade', animDuration: 1.2 } },
  { id: 'mono-note', name: 'Mono not', sample: '40.8017° N, 31.6081° E', size: 28, align: 'left',
    style: { font: 'IBM Plex Mono', weight: 400, italic: false, uppercase: false, letterSpacing: 0, lineHeight: 1.3, animIn: 'typewriter', animOut: 'fade', animDuration: 0.4, stagger: 0.035 } },
];

const loaded = new Set<string>();
export async function ensureFont(family: string, weight: number, italic: boolean) {
  const key = `${family}|${weight}|${italic}`;
  if (loaded.has(key)) return;
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${weight} 64px "${family}"`, 'AaĞğŞşİıÖöÜüÇç');
  } catch { /* may be a system font */ }
  loaded.add(key);
}
