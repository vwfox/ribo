/**
 * The cuts a screwed joint makes into its parts for printing: a counterbore
 * or countersink for the head, a nut trap, or the hole for a heat-set insert.
 */

import { INSERTS, THREADS, WASHERS, isSize, nutStandard, screwStandard } from './catalog'
import type { FastenerSpec } from './fastener'

export interface SeatSpec extends FastenerSpec {
  /** '' or 'Counterbore' (a countersunk screw gets a countersink) */
  headSeat: string
  /** '' , 'Trap' (with a nut) or 'Insert' (without one) */
  nutSeat: string
  /** Play per side, mm */
  clearance: number
}

export interface PocketSpec {
  side: 'head' | 'nut'
  /** Measured from the part's outer face, or from the face the hole edge was picked on */
  from: 'outer' | 'contact'
  shape: 'round' | 'hex' | 'cone'
  radius: number
  radiusTo?: number
  depth: number
}

/** A sunk head sits this much below the face, so nothing stands proud */
const SINK_MM = 0.2
/** A countersink's angle: the metric countersunk heads are 90° */
const COUNTERSINK_DEGREES = 90

/** True when a nut trap is asked for and possible: with a nut */
export const hasTrap = (spec: Pick<SeatSpec, 'nut' | 'nutSeat'>) => spec.nutSeat === 'Trap' && !!spec.nut
/** True when an insert hole is asked for and possible: without a nut */
export const hasInsert = (spec: Pick<SeatSpec, 'nut' | 'nutSeat'>) => spec.nutSeat === 'Insert' && !spec.nut

export function pocketsFor(spec: SeatSpec): PocketSpec[] {
  if (!isSize(spec.size)) return []
  const size = spec.size
  const thread = THREADS[size]
  const washer = WASHERS[size]
  const screw = screwStandard(spec.screw)
  const head = screw?.heads[size]
  const play = Math.max(0, spec.clearance)
  const pockets: PocketSpec[] = []
  if (spec.headSeat === 'Counterbore' && head) {
    if (screw?.countersunk) {
      const top = head.dk / 2 + play
      const bottom = thread.d / 2 + play
      const depth = (top - bottom) / Math.tan((COUNTERSINK_DEGREES * Math.PI) / 360)
      pockets.push({ side: 'head', from: 'outer', shape: 'cone', radius: top, radiusTo: bottom, depth })
    } else {
      const under = spec.headWasher ? washer.h : 0
      const width = spec.headWasher ? Math.max(head.dk, washer.d2) : head.dk
      // A hex head needs room across its corners
      pockets.push({ side: 'head', from: 'outer', shape: 'round', radius: width / 2 + play, depth: head.k + under + SINK_MM })
    }
  }
  if (hasTrap(spec)) {
    const nut = nutStandard(spec.nut)
    const m = nut?.m[size]
    const s = nut?.s[size]
    if (m && s) pockets.push({ side: 'nut', from: 'outer', shape: 'hex', radius: s / 2 + play, depth: m + SINK_MM })
  }
  if (hasInsert(spec)) {
    const insert = INSERTS[size]
    pockets.push({ side: 'nut', from: 'contact', shape: 'round', radius: insert.hole / 2, depth: insert.length + 0.5 })
  }
  return pockets
}
