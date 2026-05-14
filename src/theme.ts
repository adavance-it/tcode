export interface Theme {
  mode: 'dark' | 'light';
  borderFg: string;
  borderFocusFg: string;
  selectedBg: string;
  selectedFg: string;
  // Background used to highlight a multi-line selection in the viewer.
  // Distinct from selectedBg (used by lists) so it can be a soft pastel
  // that does not fight cli-highlight token colors underneath.
  viewerSelectionBg: string;
  viewerSelectionFg: string;
  statusBg: string;
  statusFg: string;
  dimBg: string;
  modalBorderFg: string;
  highlightLineBg: string;
  scrollbarBg: string;
  scrollbarTrackBg: string;
}

export const DARK: Theme = {
  mode: 'dark',
  borderFg: 'gray',
  borderFocusFg: 'cyan',
  selectedBg: '#3b4252',
  selectedFg: 'white',
  viewerSelectionBg: '#3b4252',
  viewerSelectionFg: '#e5e9f0',
  statusBg: 'blue',
  statusFg: 'white',
  dimBg: 'black',
  modalBorderFg: 'cyan',
  highlightLineBg: '#3a3000',
  scrollbarBg: 'cyan',
  scrollbarTrackBg: 'gray',
};

export const LIGHT: Theme = {
  mode: 'light',
  borderFg: '#888888',
  borderFocusFg: '#005f87',
  selectedBg: '#cce5ff',
  selectedFg: '#1a1a1a',
  viewerSelectionBg: '#fff3b0',
  viewerSelectionFg: '#333333',
  statusBg: '#005f87',
  statusFg: 'white',
  dimBg: '#bbbbbb',
  modalBorderFg: '#005f87',
  highlightLineBg: '#ffeeaa',
  scrollbarBg: '#005f87',
  scrollbarTrackBg: '#cccccc',
};

export type ThemeChoice = 'dark' | 'light' | 'auto';

export function detectTheme(choice: ThemeChoice = 'auto'): Theme {
  if (choice === 'dark') return DARK;
  if (choice === 'light') return LIGHT;
  // auto: COLORFGBG is set by many terminals as "fg;bg" (indexed colors).
  // bg index >= 8 is typically a light color (high-intensity).
  const cfb = process.env.COLORFGBG;
  if (cfb) {
    const parts = cfb.split(';');
    const bg = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(bg) && bg >= 8 && bg <= 15) return LIGHT;
  }
  return DARK;
}

// hex → ANSI 24-bit bg escape; named colors → 16-color bg escape.
export function bgAnsi(color: string): string {
  const rgb = parseHex(color);
  if (rgb) return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  const map: Record<string, string> = {
    black: '40', red: '41', green: '42', yellow: '43',
    blue: '44', magenta: '45', cyan: '46', white: '47',
    gray: '100', grey: '100',
  };
  return map[color] ? `\x1b[${map[color]}m` : '';
}

export function fgAnsi(color: string): string {
  const rgb = parseHex(color);
  if (rgb) return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  const map: Record<string, string> = {
    black: '30', red: '31', green: '32', yellow: '33',
    blue: '34', magenta: '35', cyan: '36', white: '37',
    gray: '90', grey: '90',
  };
  return map[color] ? `\x1b[${map[color]}m` : '';
}

function parseHex(color: string): [number, number, number] | null {
  if (!color.startsWith('#')) return null;
  const h = color.slice(1);
  const expanded = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(expanded, 16);
  if (isNaN(n)) return null;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
