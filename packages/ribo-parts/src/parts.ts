/**
 * The standard parts of one screw as simple solids, to show in the assembly
 * and to check for room: head, washers, shank and nut. Threads are left out.
 *
 * Coordinates along the screw: 0 is the head's seat, positive runs into the
 * material towards the nut.
 */

import { THREADS, WASHERS, isSize, nutStandard, screwStandard } from './catalog'
import type { FastenerSpec } from './fastener'

export interface PartSolid {
  /** Round (cylinder or ring), hexagonal prism, or a cone (countersunk head) */
  shape: 'round' | 'hex' | 'cone'
  /** Outer radius (across corners for hex); for a cone at `from` */
  radius: number
  /** Cone radius at `to` */
  radiusTo?: number
  /** Hole radius of a ring */
  inner?: number
  from: number
  to: number
  /** What it is, for messages */
  role: 'head' | 'shank' | 'washer' | 'nut'
}

/** The solids of a screw of the given length clamping `grip` mm */
export function screwSolids(spec: FastenerSpec, length: number, grip: number): PartSolid[] {
  if (!isSize(spec.size)) return []
  const size = spec.size
  const thread = THREADS[size]
  const washer = WASHERS[size]
  const screw = screwStandard(spec.screw)
  const head = screw?.heads[size]
  const solids: PartSolid[] = []
  if (screw?.countersunk && head) {
    // The head sits in the part, flush with the seat
    solids.push({ shape: 'cone', radius: head.dk / 2, radiusTo: thread.d / 2, from: 0, to: head.k, role: 'head' })
    solids.push({ shape: 'round', radius: thread.d / 2, from: head.k, to: length, role: 'shank' })
  } else {
    const under = spec.headWasher ? washer.h : 0
    if (under) solids.push({ shape: 'round', radius: washer.d2 / 2, inner: washer.d1 / 2, from: -under, to: 0, role: 'washer' })
    if (head) solids.push({ shape: spec.screw === 'ISO 4017' ? 'hex' : 'round', radius: head.dk / 2, from: -under - head.k, to: -under, role: 'head' })
    solids.push({ shape: 'round', radius: thread.d / 2, from: -under, to: -under + length, role: 'shank' })
  }
  const nut = spec.nut ? nutStandard(spec.nut) : undefined
  const m = nut?.m[size]
  const s = nut?.s[size]
  if (nut && m && s) {
    const under = spec.nutWasher ? washer.h : 0
    if (under) solids.push({ shape: 'round', radius: washer.d2 / 2, inner: washer.d1 / 2, from: grip, to: grip + under, role: 'washer' })
    // Across corners of the hexagon
    solids.push({ shape: 'hex', radius: s / Math.sqrt(3), inner: thread.d / 2, from: grip + under, to: grip + under + m, role: 'nut' })
  }
  return solids
}
