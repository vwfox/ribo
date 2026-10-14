/**
 * Metric hole presets for 3D printing. Clearance holes follow ISO 273
 * (medium), counterbores ISO 4762 heads, countersinks ISO 10642 heads, insert
 * holes the common heat-set inserts; core holes are for cutting or forming a
 * thread in the print.
 */

import { HoleType } from 'ribo-model'

export interface HolePreset {
  label: string
  group: string
  type: HoleType
  diameter: string
  depth?: string
  headDiameter?: string
  headDepth?: string
  countersinkAngle?: string
}

const sizes = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8'] as const
const clearance: Record<string, string> = { M2: '2.4', 'M2.5': '2.9', M3: '3.4', M4: '4.5', M5: '5.5', M6: '6.6', M8: '9' }
const counterbore: Record<string, [string, string]> = {
  M2: ['4.4', '2.2'],
  'M2.5': ['5.5', '2.7'],
  M3: ['6.5', '3.3'],
  M4: ['8', '4.4'],
  M5: ['10', '5.4'],
  M6: ['11', '6.4'],
  M8: ['15', '8.6'],
}
const countersink: Record<string, string> = { M2: '4.4', 'M2.5': '5.5', M3: '6.7', M4: '9', M5: '11.2', M6: '13.4', M8: '17.9' }
const insert: Record<string, [string, string]> = { M2: ['3.2', '4'], 'M2.5': ['3.6', '5'], M3: ['4', '5.7'], M4: ['5.6', '8.1'], M5: ['6.4', '9.5'], M6: ['8', '12.7'], M8: ['10', '12.7'] }
const core: Record<string, string> = { M2: '1.6', 'M2.5': '2.05', M3: '2.5', M4: '3.3', M5: '4.2', M6: '5', M8: '6.8' }

export const HOLE_PRESETS: HolePreset[] = [
  ...sizes.map((m) => ({ label: `${m} Durchgang`, group: 'Durchgangsbohrung', type: HoleType.Simple, diameter: clearance[m]! })),
  ...sizes.map((m) => ({
    label: `${m} Zylinderkopf`,
    group: 'Senkbohrung (Zylinderkopf)',
    type: HoleType.Counterbore,
    diameter: clearance[m]!,
    headDiameter: counterbore[m]![0],
    headDepth: counterbore[m]![1],
  })),
  ...sizes.map((m) => ({
    label: `${m} Senkkopf`,
    group: 'Kegelsenkung (Senkkopf 90°)',
    type: HoleType.Countersink,
    diameter: clearance[m]!,
    headDiameter: countersink[m]!,
    countersinkAngle: '90',
  })),
  ...sizes.map((m) => ({
    label: `${m} Gewindeeinsatz`,
    group: 'Gewindeeinsatz (Einschmelzmutter)',
    type: HoleType.Simple,
    diameter: insert[m]![0],
    depth: insert[m]![1],
  })),
  ...sizes.map((m) => ({ label: `${m} Kernloch`, group: 'Kernloch (Gewinde schneiden)', type: HoleType.Simple, diameter: core[m]! })),
]
