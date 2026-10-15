/**
 * Tightening torque for printed parts. The table torques of a screw are made
 * for steel; plastic gives way long before. The pre-load a printed part takes
 * is limited by the pressure under the head and the nut, or - threading into
 * the part - by the thread stripping, or by the insert. From the pre-load F
 * the torque is T = K · F · d.
 *
 * The material values are deliberately cautious guide values for printed
 * parts (layers, infill, creep), not data sheet strengths.
 */

import { THREADS, WASHERS, isSize, nutStandard, screwStandard, type Size } from './catalog'
import type { Stack } from './fastener'
import { hasInsert, hasTrap, type SeatSpec } from './pockets'

export interface Plastic {
  /** Allowed surface pressure under head, washer or nut, MPa */
  bearing: number
  /** Allowed shear in a thread cut into the part, MPa */
  shear: number
}

export const PLASTICS: Record<string, Plastic> = {
  PLA: { bearing: 20, shear: 8 },
  PETG: { bearing: 15, shear: 6 },
  ABS: { bearing: 14, shear: 6 },
  ASA: { bearing: 14, shear: 6 },
  TPU: { bearing: 3, shear: 1 },
}

/** Torque a heat-set insert takes in a printed part, Nm (guide values) */
const INSERT_TORQUE: Record<Size, number> = { M2: 0.2, 'M2.5': 0.3, M3: 0.5, M4: 1, M5: 1.6, M6: 2.5, M8: 5 }

/** Nut factor: torque per pre-load and diameter, dry steel thread */
const NUT_FACTOR = 0.2

export interface TorqueAdvice {
  /** For the printed part, Nm */
  torque: number
  /** What limits it */
  limit: string
  /** Table value for 8.8 steel on steel, Nm */
  steel: number
}

const ring = (outer: number, inner: number) => (Math.PI / 4) * Math.max(0, outer * outer - inner * inner)
const hexagon = (flats: number, inner: number) => Math.max(0, (Math.sqrt(3) / 2) * flats * flats - (Math.PI / 4) * inner * inner)

export function torqueFor(spec: SeatSpec, stack: Stack | undefined, material: string): TorqueAdvice | undefined {
  if (!isSize(spec.size)) return undefined
  const size = spec.size
  const thread = THREADS[size]
  const washer = WASHERS[size]
  const plastic = PLASTICS[material] ?? PLASTICS.PLA!
  const screw = screwStandard(spec.screw)
  const head = screw?.heads[size]
  // A countersunk head bears on its cone, washerless
  const headWasher = spec.headWasher && !screw?.countersunk
  const steel = thread.torque
  const holeHead = stack?.hole ?? thread.clearance.medium
  const holeNut = stack?.nutHole ?? thread.clearance.medium

  // Pre-loads each side takes, N (MPa · mm²)
  const limits: { force: number; limit: string }[] = []
  const headArea = ring(headWasher ? washer.d2 : (head?.dk ?? thread.d), holeHead)
  limits.push({ force: plastic.bearing * headArea, limit: `Flächenpressung unter ${headWasher ? 'der Scheibe am Kopf' : 'dem Kopf'}` })

  const nut = spec.nut ? nutStandard(spec.nut) : undefined
  if (nut) {
    const flats = nut.s[size] ?? thread.d
    const area = hasTrap(spec) ? hexagon(flats, holeNut) : spec.nutWasher ? ring(washer.d2, holeNut) : hexagon(flats, holeNut)
    limits.push({ force: plastic.bearing * area, limit: hasTrap(spec) ? 'Flächenpressung in der Mutterfalle' : `Flächenpressung unter ${spec.nutWasher ? 'der Scheibe an der Mutter' : 'der Mutter'}` })
  } else if (!hasInsert(spec)) {
    // Thread cut into the part: it strips along a cylinder of the engaged length, about half of it bearing
    const engaged = Math.min(2 * thread.d, Math.max(thread.d, (stack?.grip ?? 0) - (stack?.headPart ?? 0)))
    limits.push({ force: plastic.shear * Math.PI * thread.d * engaged * 0.5, limit: 'Ausreißen des Gewindes im Bauteil' })
  }

  const weakest = limits.reduce((a, b) => (b.force < a.force ? b : a))
  let torque = (NUT_FACTOR * weakest.force * thread.d) / 1000
  let limit = weakest.limit
  if (hasInsert(spec) && INSERT_TORQUE[size] < torque) {
    torque = INSERT_TORQUE[size]
    limit = 'Halt der Einschmelzmutter'
  }
  if (steel < torque) {
    torque = steel
    limit = 'Normmoment der Schraube'
  }
  // To the nearest 0.05 Nm, at least that
  return { torque: Math.max(0.05, Math.round(torque * 20) / 20), limit, steel }
}
