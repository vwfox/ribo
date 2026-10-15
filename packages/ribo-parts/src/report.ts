/**
 * Screwed joints of a design: what each screw clamps, which screw it takes,
 * and the bill of materials of all of them.
 */

import type { BodyMesh, DocumentService, Matrix, Vec3 } from 'ribo-contracts'
import { applyDirection, applyPoint } from 'ribo-geometry'
import type { Fastening, JointOrigin } from 'ribo-model'
import { WASHER_STANDARD, nutStandard, screwStandard } from './catalog'
import { chooseFastener, partName, type FastenerChoice, type Stack } from './fastener'
import { materialIn, stackBetween, type HoleEdge } from './stack'
import { screwSolids, type PartSolid } from './parts'

export interface ScrewReport {
  /** Index of the hole pair in the fastening */
  hole: number
  stack?: Stack
  choice?: FastenerChoice
  /** The screw's solids, along the stack's seat and direction */
  solids?: PartSolid[]
  problems: string[]
}

export interface AssemblyView {
  bodies: BodyMesh[]
  placements: Matrix[]
  componentIndexOf(component: JointOrigin['component'] | undefined): number
  /** Fixed screw length from its expression, undefined for automatic */
  length(fastening: Fastening): number | undefined
}

/** The assembly as the document has it now */
export function viewOf(document: DocumentService): AssemblyView {
  return {
    bodies: document.result.value?.bodies ?? [],
    placements: document.placements.value,
    componentIndexOf: (component) => document.componentIndexOf(component ?? undefined),
    length: (fastening) => {
      const text = (fastening.length ?? '').trim()
      if (!text) return undefined
      try {
        return document.evaluate(text)
      } catch {
        return undefined
      }
    },
  }
}

function edgeOf(origin: JointOrigin, placement: Matrix): HoleEdge {
  const point: Vec3 = [origin.originX, origin.originY, origin.originZ]
  const axis: Vec3 = [origin.zX, origin.zY, origin.zZ]
  return { point: applyPoint(placement, point), axis: applyDirection(placement, axis), radius: origin.radius ?? 0 }
}

/** Reports per fastening, kept while the bodies, placements and the fastening stay the same */
const cache = new WeakMap<Fastening, { bodies: BodyMesh[]; placements: Matrix[]; key: string; reports: ScrewReport[] }>()

function keyOf(fastening: Fastening, length: number | undefined): string {
  const origin = (o: JointOrigin | undefined) => (o ? [o.originX, o.originY, o.originZ, o.zX, o.zY, o.zZ, o.radius, o.component?.name].join(',') : '-')
  return [fastening.screw, fastening.size, length, fastening.headWasher, fastening.nut, fastening.nutWasher, ...fastening.holes.toArray().flatMap((h) => [origin(h.head), origin(h.nut)])].join('|')
}

export function reportFastening(fastening: Fastening, view: AssemblyView): ScrewReport[] {
  const length = view.length(fastening)
  const key = keyOf(fastening, length)
  const cached = cache.get(fastening)
  if (cached && cached.bodies === view.bodies && cached.placements === view.placements && cached.key === key) return cached.reports
  const reports = computeReports(fastening, view, length)
  cache.set(fastening, { bodies: view.bodies, placements: view.placements, key, reports })
  return reports
}

const ROLES: Record<PartSolid['role'], string> = { head: 'Der Kopf', washer: 'Die Scheibe', nut: 'Die Mutter', shank: 'Der Schaft' }

function computeReports(fastening: Fastening, view: AssemblyView, length: number | undefined): ScrewReport[] {
  // Bodies of components whose placement is not known yet (while the design is being opened) are left out
  const placed = (component: number) =>
    view.placements[component] ? view.bodies.filter((mesh) => mesh.component === component).map((mesh) => ({ mesh, placement: view.placements[component]! })) : []
  const everything = view.bodies.filter((mesh) => view.placements[mesh.component]).map((mesh) => ({ mesh, placement: view.placements[mesh.component]! }))
  const spec = {
    screw: fastening.screw ?? 'ISO 4762',
    size: fastening.size ?? 'M3',
    length,
    headWasher: !!fastening.headWasher,
    nut: fastening.nut ?? '',
    nutWasher: !!fastening.nutWasher,
  }
  return fastening.holes.toArray().map((hole, index) => {
    if (!hole.head || !hole.nut) return { hole: index, problems: ['Bohrung auf der Mutterseite fehlt'] }
    const headSide = view.componentIndexOf(hole.head.component)
    const nutSide = view.componentIndexOf(hole.nut.component)
    if (headSide === nutSide) return { hole: index, problems: ['Beide Bohrungen liegen im selben Bauteil'] }
    if (!view.placements[headSide] || !view.placements[nutSide]) return { hole: index, problems: [] }
    const head = edgeOf(hole.head, view.placements[headSide]!)
    const nut = edgeOf(hole.nut, view.placements[nutSide]!)
    const stack = stackBetween(placed(headSide), placed(nutSide), head, nut)
    if (!stack) return { hole: index, problems: ['Kein Material entlang der Bohrung gefunden'] }
    const choice = chooseFastener(spec, stack)
    if (!choice) return { hole: index, stack, problems: [`Unbekannte Größe ${spec.size}`] }
    const problems = [...choice.problems]
    const solids = choice.length !== undefined ? screwSolids(spec, choice.length, spec.nut ? stack.grip : 0) : []
    // Head, washers and nut need room; a countersunk head and the shank sit in the part on purpose
    if (!stack.overlap) {
      for (const solid of solids) {
        if (solid.role === 'shank' || solid.shape === 'cone') continue
        const depth = materialIn(everything, stack.seat, stack.direction, solid.radius, solid.from + 0.01, solid.to - 0.01)
        if (depth) {
          const where = solid.role === 'head' || (solid.role === 'washer' && solid.from < 0) ? 'Senkung zu klein oder zu flach?' : 'Platz für die Mutter fehlt'
          problems.push(`${ROLES[solid.role]} stößt ${depth.toFixed(1)} mm in Material – ${where}`)
        }
      }
    }
    return { hole: index, stack, choice, solids, problems }
  })
}

export interface BomLine {
  part: string
  name: string
  count: number
}

/** All screws, nuts and washers of the screwed joints, counted */
export function billOfMaterials(fastenings: Fastening[], view: AssemblyView): BomLine[] {
  const lines = new Map<string, BomLine>()
  const add = (part: string, name: string, count: number) => {
    const line = lines.get(part) ?? { part, name, count: 0 }
    line.count += count
    lines.set(part, line)
  }
  for (const fastening of fastenings) {
    if (fastening.suppressed) continue
    const screw = screwStandard(fastening.screw ?? '')
    const nut = fastening.nut ? nutStandard(fastening.nut) : undefined
    for (const report of reportFastening(fastening, view)) {
      if (!report.choice) continue
      add(partName(fastening.screw ?? '', fastening.size ?? '', report.choice.length), screw?.name ?? 'Schraube', 1)
      if (nut) add(partName(nut.id, fastening.size ?? ''), nut.name, 1)
      const washers = (fastening.headWasher ? 1 : 0) + (nut && fastening.nutWasher ? 1 : 0)
      if (washers) add(partName(WASHER_STANDARD, fastening.size ?? ''), 'Scheibe', washers)
    }
  }
  return [...lines.values()].sort((a, b) => a.part.localeCompare(b.part, 'de', { numeric: true }))
}
