/**
 * Printer and material settings. They belong to the user's printer, not to a
 * design, so they live in this browser's storage.
 */

import type { Vec3 } from 'ribo-contracts'

export interface PrintSettings {
  printer: string
  bed: Vec3
  nozzle: number
  /** Walls thinner than this are flagged, mm */
  minWall: number
  /** Overhangs steeper than this, measured from vertical, are flagged, degrees */
  overhangAngle: number
  material: string
  /** Filament diameter, mm */
  filament: number
}

export const PRINTERS: { id: string; label: string; bed: Vec3 }[] = [
  { id: 'ender3', label: 'Creality Ender 3', bed: [220, 220, 250] },
  { id: 'mk4', label: 'Prusa MK4', bed: [250, 210, 220] },
  { id: 'mini', label: 'Prusa MINI', bed: [180, 180, 180] },
  { id: 'bambu', label: 'Bambu Lab X1/P1', bed: [256, 256, 256] },
  { id: 'a1mini', label: 'Bambu Lab A1 mini', bed: [180, 180, 180] },
  { id: 'custom', label: 'Eigene Größe', bed: [200, 200, 200] },
]

/** Densities in g/cm³ */
export const MATERIALS: { id: string; label: string; density: number }[] = [
  { id: 'PLA', label: 'PLA', density: 1.24 },
  { id: 'PETG', label: 'PETG', density: 1.27 },
  { id: 'ABS', label: 'ABS', density: 1.04 },
  { id: 'ASA', label: 'ASA', density: 1.07 },
  { id: 'TPU', label: 'TPU', density: 1.21 },
]

export const DEFAULT_SETTINGS: PrintSettings = {
  printer: 'ender3',
  bed: [220, 220, 250],
  nozzle: 0.4,
  minWall: 0.8,
  overhangAngle: 45,
  material: 'PLA',
  filament: 1.75,
}

const KEY = 'ribo.print.settings'

export function loadSettings(): PrintSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PrintSettings> | null
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: PrintSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked: the settings hold for this session
  }
}
