export interface Theme {
  mode: 'dark' | 'light';
  borderFg: string;
  borderFocusFg: string;
  selectedBg: string;
  selectedFg: string;
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
  selectedBg: 'blue',
  selectedFg: 'white',
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
  selectedBg: '#005f87',
  selectedFg: 'white',
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
  if (color.startsWith('#')) {
    const h = color.slice(1);
    const expanded = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(expanded, 16);
    if (isNaN(n)) return '';
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `\x1b[48;2;${r};${g};${b}m`;
  }
  const map: Record<string, string> = {
    black: '40', red: '41', green: '42', yellow: '43',
    blue: '44', magenta: '45', cyan: '46', white: '47',
    gray: '100', grey: '100',
  };
  return map[color] ? `\x1b[${map[color]}m` : '';
}
