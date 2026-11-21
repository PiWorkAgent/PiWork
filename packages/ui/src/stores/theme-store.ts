import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ThemeMode } from '@pi/types';

/** The root font size Tailwind's rem scale is written against. */
export const BASE_ROOT_FONT_SIZE = 16;

/**
 * Scale the whole interface by changing the root font size.
 *
 * Everything Tailwind expresses in rem follows — text, spacing, radii, control
 * heights — which is exactly the "字号" behaviour. Deliberately NOT Electron's
 * zoom factor: zoom scales CSS pixels against window device pixels, and the
 * native plugin views are positioned from CSS-space rects reported by the
 * shell, so zooming would leave every panel misaligned inside its slot.
 */
export function applyFontScale(scale: number): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${BASE_ROOT_FONT_SIZE * scale}px`;
}

interface ThemeState {
  theme: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  /**
   * Interface text scale, 1 = default. Applies to every window: like the theme
   * it is a device-level appearance choice, not a per-window layout state.
   */
  fontScale: number;
  setTheme: (theme: ThemeMode) => void;
  setResolvedTheme: (theme: 'light' | 'dark') => void;
  setFontScale: (scale: number) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      resolvedTheme: 'light',
      fontScale: 1,
      setTheme: (theme) => set({ theme }),
      setResolvedTheme: (theme) => set({ resolvedTheme: theme }),
      // Apply here rather than in an effect: the setting is a root style, and
      // doing it in the action keeps the resize in the same tick as the click.
      setFontScale: (scale) => {
        applyFontScale(scale);
        set({ fontScale: scale });
      },
    }),
    {
      name: 'pi-theme-storage',
      partialize: (state) => ({ theme: state.theme, fontScale: state.fontScale }),
      // Rehydration is synchronous, so the saved size is on <html> before the
      // first React render — no flash of default-size text on launch.
      onRehydrateStorage: () => (state) => {
        if (state) applyFontScale(state.fontScale);
      },
    },
  ),
);

/**
 * Keep the OTHER windows in step. Appearance is a device-level choice, but
 * localStorage is per renderer: without this a second window kept the old
 * theme/size until reload — and its next persist write (toggling the theme)
 * put the old fontScale back for the following launch.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'pi-theme-storage' || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as {
        state?: { theme?: ThemeMode; fontScale?: number };
      } | null;
      const incoming = parsed?.state;
      if (!incoming) return;
      const current = useThemeStore.getState();
      if (typeof incoming.fontScale === 'number' && incoming.fontScale !== current.fontScale) {
        current.setFontScale(incoming.fontScale);
      }
      if (incoming.theme && incoming.theme !== current.theme) {
        current.setTheme(incoming.theme);
      }
    } catch {
      /* malformed payload — keep the current appearance */
    }
  });
}
