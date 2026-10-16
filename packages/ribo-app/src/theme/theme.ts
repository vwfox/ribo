/**
 * Applying a theme: its tokens become custom properties on the root element,
 * which PrimeVue's preset and ribo's own styles read - so a change takes
 * effect everywhere at once. Dark themes also switch PrimeVue's dark scheme
 * (the `dark-theme` class) and tell the browser via color-scheme.
 *
 * The choice is kept per browser, like the window layout: it says how this
 * person wants to look at ribo, not what a design contains.
 *
 * After daanse board's useTheme.
 */

import { computed, ref } from 'vue'
import { DEFAULT_THEME_ID, THEMES, type Theme } from './themes'

const KEY = 'ribo.theme'

function read(): string {
  try {
    const id = localStorage.getItem(KEY)
    return id && THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME_ID
  } catch {
    // Private windows and cleared site data are normal, not an error
    return DEFAULT_THEME_ID
  }
}

const themeId = ref(read())

export const activeTheme = computed<Theme>(() => THEMES.find((t) => t.id === themeId.value) ?? THEMES[0]!)

function paint() {
  const theme = activeTheme.value
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value)
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.setAttribute('data-theme', theme.dark ? 'dark' : 'light')
  root.classList.toggle('dark-theme', theme.dark)
  // For what draws without CSS, like the 3D view
  window.dispatchEvent(new CustomEvent('ribo:theme', { detail: theme.id }))
}

export function selectTheme(id: string): void {
  if (!THEMES.some((t) => t.id === id)) return
  themeId.value = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Remembering is a convenience; failing to must not break ribo
  }
  paint()
}

/** The next theme in the list, for a single button that cycles through them */
export function nextTheme(): Theme {
  const index = THEMES.findIndex((t) => t.id === themeId.value)
  return THEMES[(index + 1) % THEMES.length]!
}

/** Paints the stored (or default) theme; once, before the app is mounted */
export function initTheme(): void {
  paint()
}

export { THEMES, type Theme }
