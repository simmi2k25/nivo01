export type ThemeMode = 'light' | 'dark';
export const BUBBLES = [
  { id: 'periwinkle', color: '#6f84de' },
  { id: 'pink', color: '#e9849f' },
  { id: 'mint', color: '#4fb69a' },
  { id: 'butter', color: '#f2c14e' },
  { id: 'lilac', color: '#a08ae0' },
  { id: 'navy', color: '#2f3a78' },
] as const;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export function getTheme(): ThemeMode {
  return read('nivo.theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#151a33' : '#F2F5FE');
  write('nivo.theme', mode);
}

export function applyBubble(id: string) {
  document.documentElement.dataset.bubble = id;
}

export function getPref(key: string, fallback: string) {
  return read(`nivo.${key}`) ?? fallback;
}
export function setPref(key: string, value: string) {
  write(`nivo.${key}`, value);
}
