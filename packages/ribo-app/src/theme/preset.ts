/**
 * PrimeVue's Aura preset dressed in the theme tokens. Every value is a
 * reference to a custom property (var(--color-accent) …) rather than a
 * colour, so switching the theme only repaints the properties - PrimeVue
 * itself is set up once.
 *
 * Aura draws with two scales: primary (the accent) and surface (grounds and
 * text). Both are spread out of the theme's few tokens with color-mix.
 */

import { definePreset } from '@primeuix/themes'
import Aura from '@primeuix/themes/aura'

const mix = (a: string, b: string, share: number) => `color-mix(in srgb, var(--${a}) ${share}%, var(--${b}))`
const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/** The accent as a scale: light tints above 500, dark shades below */
const primary = Object.fromEntries(
  steps.map((step) => {
    if (step === 500) return [step, 'var(--color-accent)']
    const toward = step < 500 ? '#ffffff' : '#000000'
    const share = step < 500 ? 100 - (500 - step) / 5.5 : 100 - (step - 500) / 5.5
    return [step, `color-mix(in srgb, var(--color-accent) ${Math.round(share)}%, ${toward})`]
  }),
)

/** Light schemes: 0 is the brightest ground, 950 the text */
const lightSurface = {
  0: 'var(--color-raised)',
  50: 'var(--color-pane)',
  100: 'var(--color-bg)',
  200: 'var(--color-divider)',
  300: 'var(--color-outline)',
  400: mix('color-outline', 'color-dim', 50),
  500: 'var(--color-dim)',
  600: mix('color-dim', 'color-fg', 66),
  700: mix('color-dim', 'color-fg', 33),
  800: 'var(--color-fg)',
  900: 'var(--color-fg)',
  950: 'var(--color-fg)',
}

/** Dark schemes: 950 is the deepest ground, 0 the text */
const darkSurface = {
  0: 'var(--color-fg)',
  50: 'var(--color-fg)',
  100: mix('color-fg', 'color-dim', 66),
  200: mix('color-fg', 'color-dim', 33),
  300: 'var(--color-dim)',
  400: mix('color-dim', 'color-outline', 50),
  500: 'var(--color-outline)',
  600: mix('color-outline', 'color-divider', 50),
  700: 'var(--color-divider)',
  800: 'var(--color-raised)',
  900: 'var(--color-pane)',
  950: 'var(--color-bg)',
}

const scheme = (surface: Record<number, string>) => ({
  surface,
  primary: {
    color: 'var(--color-accent)',
    contrastColor: 'var(--color-onAccent)',
    hoverColor: mix('color-accent', 'color-fg', 85),
    activeColor: mix('color-accent', 'color-fg', 75),
  },
  highlight: {
    background: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
    focusBackground: 'color-mix(in srgb, var(--color-accent) 26%, transparent)',
    color: 'var(--color-fg)',
    focusColor: 'var(--color-fg)',
  },
  formField: {
    background: 'var(--color-bg)',
    disabledBackground: 'var(--color-pane)',
    filledBackground: 'var(--color-bg)',
    filledFocusBackground: 'var(--color-bg)',
    borderColor: 'var(--color-outline)',
    hoverBorderColor: mix('color-outline', 'color-fg', 70),
    focusBorderColor: 'var(--color-accent)',
    color: 'var(--color-fg)',
    disabledColor: 'var(--color-dim)',
    placeholderColor: 'var(--color-dim)',
    floatLabelColor: 'var(--color-dim)',
    iconColor: 'var(--color-dim)',
  },
  text: {
    color: 'var(--color-fg)',
    hoverColor: 'var(--color-fg)',
    mutedColor: 'var(--color-dim)',
    hoverMutedColor: 'var(--color-fg)',
  },
  content: {
    background: 'var(--color-pane)',
    hoverBackground: 'var(--color-raised)',
    borderColor: 'var(--color-divider)',
    color: 'var(--color-fg)',
    hoverColor: 'var(--color-fg)',
  },
  overlay: {
    select: { background: 'var(--color-raised)', borderColor: 'var(--color-divider)', color: 'var(--color-fg)' },
    popover: { background: 'var(--color-raised)', borderColor: 'var(--color-divider)', color: 'var(--color-fg)' },
    modal: { background: 'var(--color-pane)', borderColor: 'var(--color-divider)', color: 'var(--color-fg)' },
  },
  list: {
    option: {
      focusBackground: 'var(--color-raised)',
      selectedBackground: 'color-mix(in srgb, var(--color-accent) 18%, transparent)',
      selectedFocusBackground: 'color-mix(in srgb, var(--color-accent) 26%, transparent)',
      color: 'var(--color-fg)',
      focusColor: 'var(--color-fg)',
      selectedColor: 'var(--color-fg)',
      selectedFocusColor: 'var(--color-fg)',
    },
  },
  navigation: {
    item: { focusBackground: 'var(--color-raised)', activeBackground: 'var(--color-raised)', color: 'var(--color-fg)', focusColor: 'var(--color-fg)', activeColor: 'var(--color-fg)' },
  },
})

export const RiboPreset = definePreset(Aura, {
  primitive: {
    borderRadius: {
      none: '0',
      xs: 'var(--radius-xs)',
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-lg)',
    },
  },
  semantic: {
    primary,
    colorScheme: {
      light: scheme(lightSurface),
      dark: scheme(darkSurface),
    },
  },
})
