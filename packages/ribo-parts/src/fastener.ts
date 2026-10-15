/**
 * Choosing the screw of a screwed joint: the length from what it clamps,
 * and the checks a printed part needs.
 */

import { THREADS, WASHERS, isSize, nutStandard, screwStandard, type Size } from './catalog'

export interface FastenerSpec {
  screw: string
  size: string
  /** Fixed length, or undefined to choose one */
  length?: number
  headWasher: boolean
  /** Nut standard id, or '' to thread into the part (or an insert) */
  nut: string
  nutWasher: boolean
}

/** What one screw position clamps, along its axis, mm */
export interface Stack {
  /** From the head's seat to the nut's seat, gaps included */
  grip: number
  /** The material of the part on the head side alone */
  headPart: number
  /** Diameter of the hole on the head side, if known */
  hole?: number
  /** Diameter of the hole on the nut side, if known */
  nutHole?: number
  /** How far the two parts run into each other along the axis, if they do */
  overlap?: number
  /** Where the head (or its washer) sits, world coordinates, on the axis */
  seat: [number, number, number]
  /** Unit axis from the head into the material, towards the nut */
  direction: [number, number, number]
}

export interface FastenerChoice {
  size: Size
  /** Chosen (or fixed) length; undefined when no standard length fits */
  length?: number
  /** Least length the stack needs */
  needed: number
  /** Screw end beyond the nut, or thread engaged in the part without nut */
  projection?: number
  problems: string[]
  hints: string[]
}

/** Thread engagement wanted in a printed part (or insert) when there is no nut, in diameters */
const ENGAGEMENT_DIAMETERS = 2
/** Thread turns that should show beyond a nut */
const PROJECTION_TURNS = 2

export function chooseFastener(spec: FastenerSpec, stack: Stack): FastenerChoice | undefined {
  if (!isSize(spec.size)) return undefined
  const size = spec.size
  const thread = THREADS[size]
  const screw = screwStandard(spec.screw)
  const nut = spec.nut ? nutStandard(spec.nut) : undefined
  const problems: string[] = []
  const hints: string[] = []
  if (!screw?.heads[size]) problems.push(`${spec.screw} gibt es nicht in ${size}`)
  if (spec.nut && !nut?.m[size]) problems.push(`${spec.nut} gibt es nicht in ${size}`)

  const washer = WASHERS[size].h
  const under = spec.headWasher ? washer : 0
  let needed: number
  if (nut) {
    const m = nut.m[size] ?? 0
    needed = stack.grip + under + (spec.nutWasher ? washer : 0) + m + PROJECTION_TURNS * thread.pitch
  } else {
    needed = stack.headPart + under + ENGAGEMENT_DIAMETERS * thread.d
  }

  const lengths = screw?.lengths[size] ?? []
  // Into the part: the longest screw that stays inside it and still bites deep enough
  const room = stack.grip - stack.headPart
  const inside = nut
    ? undefined
    : lengths.filter((l) => {
        const engaged = l - stack.headPart - under
        return engaged >= 1.5 * thread.d - 1e-6 && engaged <= Math.min(room, ENGAGEMENT_DIAMETERS * thread.d) + 1e-6
      }).at(-1)
  const length = spec.length ?? inside ?? lengths.find((l) => l >= needed - 1e-6)
  if (length === undefined) problems.push(`Keine Normlänge bis ${lengths.at(-1) ?? '–'} mm reicht – nötig ${needed.toFixed(1)} mm`)
  else if (spec.length !== undefined && !lengths.includes(spec.length)) hints.push(`${spec.length} mm ist keine Normlänge von ${spec.screw} ${size}`)

  if (stack.overlap) problems.push(`Die Teile durchdringen sich um ${stack.overlap.toFixed(1)} mm – „Umkehren“ schalten oder die Bohrungskanten an den Berührflächen anklicken`)

  let projection: number | undefined
  if (length !== undefined) {
    if (nut) {
      const m = nut.m[size] ?? 0
      projection = length - (stack.grip + under + (spec.nutWasher ? washer : 0) + m)
      if (projection < 0) problems.push(`Zu kurz: die Mutter fasst ${Math.max(0, m + projection).toFixed(1)} von ${m} mm Gewinde`)
      else if (projection < thread.pitch) hints.push('Schraube schließt knapp mit der Mutter ab')
      else if (projection > 4 * thread.d) hints.push(`Steht ${projection.toFixed(1)} mm über die Mutter hinaus`)
    } else {
      projection = length - stack.headPart - under
      if (projection <= 0) problems.push('Zu kurz: erreicht das Gegenstück nicht')
      else if (projection < 1.5 * thread.d) hints.push(`Nur ${projection.toFixed(1)} mm Gewinde im Gegenstück – für Kunststoff mindestens ${1.5 * thread.d} mm`)
      if (room > 0 && projection > room + 1e-6) problems.push(`Zu lang: ragt ${(projection - room).toFixed(1)} mm aus dem Gegenstück`)
    }
  }

  const { fine, medium, coarse } = thread.clearance
  const head = screw?.heads[size]
  if (stack.hole !== undefined) {
    // The head side is a through hole; what the head rests on must cover it
    const rest = spec.headWasher ? WASHERS[size].d2 : (head?.dk ?? thread.d)
    if (stack.hole < thread.d - 1e-3) problems.push(`Bohrung Kopfseite ⌀${stack.hole.toFixed(2)} ist kleiner als die Schraube`)
    else if (!screw?.countersunk && stack.hole >= rest - 0.3) problems.push(`${spec.headWasher ? 'Die Scheibe' : 'Der Kopf'} (⌀${rest}) fällt durch die Bohrung Kopfseite ⌀${stack.hole.toFixed(2)} – größere Schraube oder Scheibe`)
    else if (stack.hole < fine - 0.05) hints.push(`Bohrung Kopfseite ⌀${stack.hole.toFixed(2)} ist enger als das Durchgangsloch fein (⌀${fine}) – für den Druck eher ⌀${medium}`)
    else if (stack.hole > coarse + 0.05) hints.push(`Bohrung Kopfseite ⌀${stack.hole.toFixed(2)} ist weiter als das Durchgangsloch grob (⌀${coarse})${spec.headWasher || screw?.countersunk ? '' : ' – Scheibe unter dem Kopf empfohlen'}`)
  }
  if (stack.nutHole !== undefined) {
    if (nut) {
      // A wider hole on the nut side is fine as long as the nut (or its washer) still bears on the part
      const rest = spec.nutWasher ? WASHERS[size].d2 : (nut.s[size] ?? thread.d)
      if (stack.nutHole < thread.d - 1e-3) problems.push(`Bohrung Mutterseite ⌀${stack.nutHole.toFixed(2)} ist kleiner als die Schraube`)
      else if (stack.nutHole >= rest - 0.3) problems.push(`Die ${spec.nutWasher ? 'Scheibe' : 'Mutter'} (⌀${rest}) fällt durch die Bohrung Mutterseite ⌀${stack.nutHole.toFixed(2)} – größere Schraube oder Scheibe`)
      else if (stack.nutHole > coarse + 0.05) hints.push(`Bohrung Mutterseite ⌀${stack.nutHole.toFixed(2)} ist weiter als das Durchgangsloch grob (⌀${coarse})${spec.nutWasher ? ' – die Scheibe deckt sie ab' : ' – Scheibe unter der Mutter empfohlen'}`)
    } else if (stack.nutHole >= thread.d - 0.05) {
      // Threading into the part needs a core hole (or an insert's hole), not a through hole
      hints.push(`Bohrung Gegenstück ⌀${stack.nutHole.toFixed(2)} ist so weit wie das Gewinde – ohne Mutter fasst die Schraube dort nur mit Einschmelzmutter`)
    }
  }
  return { size, length, needed, projection, problems, hints }
}

/** Bill-of-materials line of a part, e.g. "ISO 4762 M3×16" */
export function partName(standard: string, size: string, length?: number) {
  return length === undefined ? `${standard} ${size}` : `${standard} ${size}×${length}`
}
