/**
 * Standard parts for screwed joints: metric ISO screws, nuts and washers,
 * clearance holes and tightening torques. Plain data, mm and Nm.
 *
 * Head and nut sizes are the nominal (maximum) values of the standards; the
 * tightening torques are the usual table values for strength class 8.8,
 * steel on steel, friction μ = 0.12.
 */

export type Size = 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8'

export const SIZES: Size[] = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8']

export interface Thread {
  /** Nominal diameter */
  d: number
  pitch: number
  /** Through holes per ISO 273: fine, medium, coarse */
  clearance: { fine: number; medium: number; coarse: number }
  /** Tightening torque for 8.8 steel on steel, Nm */
  torque: number
}

export const THREADS: Record<Size, Thread> = {
  M2: { d: 2, pitch: 0.4, clearance: { fine: 2.2, medium: 2.4, coarse: 2.6 }, torque: 0.35 },
  'M2.5': { d: 2.5, pitch: 0.45, clearance: { fine: 2.7, medium: 2.9, coarse: 3.1 }, torque: 0.7 },
  M3: { d: 3, pitch: 0.5, clearance: { fine: 3.2, medium: 3.4, coarse: 3.6 }, torque: 1.2 },
  M4: { d: 4, pitch: 0.7, clearance: { fine: 4.3, medium: 4.5, coarse: 4.8 }, torque: 2.8 },
  M5: { d: 5, pitch: 0.8, clearance: { fine: 5.3, medium: 5.5, coarse: 5.8 }, torque: 5.5 },
  M6: { d: 6, pitch: 1, clearance: { fine: 6.4, medium: 6.6, coarse: 7 }, torque: 9.5 },
  M8: { d: 8, pitch: 1.25, clearance: { fine: 8.4, medium: 9, coarse: 10 }, torque: 23 },
}

export interface ScrewHead {
  /** Head diameter (across corners for hex heads) */
  dk: number
  /** Head height */
  k: number
}

export interface ScrewStandard {
  id: string
  name: string
  /** Countersunk: the length includes the head, which sits in the part */
  countersunk: boolean
  heads: Partial<Record<Size, ScrewHead>>
  lengths: Partial<Record<Size, number[]>>
}

const range = (...values: number[]) => values

export const SCREWS: ScrewStandard[] = [
  {
    id: 'ISO 4762',
    name: 'Zylinderschraube mit Innensechskant',
    countersunk: false,
    heads: {
      M2: { dk: 3.8, k: 2 },
      'M2.5': { dk: 4.5, k: 2.5 },
      M3: { dk: 5.5, k: 3 },
      M4: { dk: 7, k: 4 },
      M5: { dk: 8.5, k: 5 },
      M6: { dk: 10, k: 6 },
      M8: { dk: 13, k: 8 },
    },
    lengths: {
      M2: range(3, 4, 5, 6, 8, 10, 12, 16, 20),
      'M2.5': range(4, 5, 6, 8, 10, 12, 16, 20, 25),
      M3: range(4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40),
      M4: range(5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50),
      M5: range(6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60),
      M6: range(8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70),
      M8: range(10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80),
    },
  },
  {
    id: 'ISO 4017',
    name: 'Sechskantschraube, Gewinde bis Kopf',
    countersunk: false,
    heads: {
      M2: { dk: 4.4, k: 1.4 },
      'M2.5': { dk: 5.5, k: 1.7 },
      M3: { dk: 6, k: 2 },
      M4: { dk: 7.7, k: 2.8 },
      M5: { dk: 8.8, k: 3.5 },
      M6: { dk: 11.1, k: 4 },
      M8: { dk: 14.4, k: 5.3 },
    },
    lengths: {
      M2: range(4, 5, 6, 8, 10, 12, 16, 20),
      'M2.5': range(5, 6, 8, 10, 12, 16, 20, 25),
      M3: range(5, 6, 8, 10, 12, 16, 20, 25, 30),
      M4: range(6, 8, 10, 12, 16, 20, 25, 30, 35, 40),
      M5: range(8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50),
      M6: range(10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60),
      M8: range(12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80),
    },
  },
  {
    id: 'ISO 7380',
    name: 'Flachkopfschraube mit Innensechskant',
    countersunk: false,
    heads: {
      M3: { dk: 5.7, k: 1.65 },
      M4: { dk: 7.6, k: 2.2 },
      M5: { dk: 9.5, k: 2.75 },
      M6: { dk: 10.5, k: 3.3 },
      M8: { dk: 14, k: 4.4 },
    },
    lengths: {
      M3: range(4, 5, 6, 8, 10, 12, 16, 20, 25, 30),
      M4: range(6, 8, 10, 12, 16, 20, 25, 30, 35, 40),
      M5: range(8, 10, 12, 16, 20, 25, 30, 35, 40),
      M6: range(10, 12, 16, 20, 25, 30, 35, 40),
      M8: range(12, 16, 20, 25, 30, 35, 40, 45, 50),
    },
  },
  {
    id: 'ISO 10642',
    name: 'Senkschraube mit Innensechskant',
    countersunk: true,
    heads: {
      M3: { dk: 6.72, k: 1.86 },
      M4: { dk: 8.96, k: 2.48 },
      M5: { dk: 11.2, k: 3.1 },
      M6: { dk: 13.44, k: 3.72 },
      M8: { dk: 17.92, k: 4.96 },
    },
    lengths: {
      M3: range(6, 8, 10, 12, 16, 20, 25, 30),
      M4: range(8, 10, 12, 16, 20, 25, 30, 35, 40),
      M5: range(8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50),
      M6: range(10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60),
      M8: range(12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80),
    },
  },
]

export interface NutStandard {
  id: string
  name: string
  /** Height per size */
  m: Partial<Record<Size, number>>
  /** Width across flats per size */
  s: Partial<Record<Size, number>>
}

const HEX_FLATS: Record<Size, number> = { M2: 4, 'M2.5': 5, M3: 5.5, M4: 7, M5: 8, M6: 10, M8: 13 }

export const NUTS: NutStandard[] = [
  {
    id: 'ISO 4032',
    name: 'Sechskantmutter',
    m: { M2: 1.6, 'M2.5': 2, M3: 2.4, M4: 3.2, M5: 4.7, M6: 5.2, M8: 6.8 },
    s: HEX_FLATS,
  },
  {
    id: 'ISO 4035',
    name: 'Sechskantmutter, niedrig',
    m: { M2: 1.2, 'M2.5': 1.6, M3: 1.8, M4: 2.2, M5: 2.7, M6: 3.2, M8: 4 },
    s: HEX_FLATS,
  },
  {
    id: 'ISO 10511',
    name: 'Sicherungsmutter mit Klemmteil, niedrig',
    m: { M3: 4, M4: 5, M5: 5, M6: 6, M8: 8 },
    s: HEX_FLATS,
  },
]

export interface Washer {
  /** Inner, outer diameter, thickness */
  d1: number
  d2: number
  h: number
}

/** Plain washers ISO 7089 */
export const WASHER_STANDARD = 'ISO 7089'
export const WASHERS: Record<Size, Washer> = {
  M2: { d1: 2.2, d2: 5, h: 0.3 },
  'M2.5': { d1: 2.7, d2: 6, h: 0.5 },
  M3: { d1: 3.2, d2: 7, h: 0.5 },
  M4: { d1: 4.3, d2: 9, h: 0.8 },
  M5: { d1: 5.3, d2: 10, h: 1 },
  M6: { d1: 6.4, d2: 12, h: 1.6 },
  M8: { d1: 8.4, d2: 16, h: 1.6 },
}

export const screwStandard = (id: string) => SCREWS.find((s) => s.id === id)
export const nutStandard = (id: string) => NUTS.find((n) => n.id === id)
export const isSize = (size: string): size is Size => (SIZES as string[]).includes(size)
