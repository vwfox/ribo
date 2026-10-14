/**
 * Projection: body edges and the sketch axes as fixed reference geometry.
 *
 * Body edges come as tessellated polylines. Projected onto the sketch plane
 * they are recognised again as what they were - a straight edge as a line, a
 * round one as a circle or arc - and only anything else stays a polyline.
 */

import type { EObject } from '@emfts/core'
import type { Vec2 } from 'ribo-contracts'
import { ConstraintKind, type SketchCurve } from 'ribo-model'
import { dist, type SketchEditor } from './SketchEditor'
import { Tool, circleThrough, type Preview, type ToolPointer } from './tools'

/** How far polyline points may stray from a fitted line or circle, mm */
const FIT_TOLERANCE = 1e-3
/** Polylines that fit nothing are thinned to this deviation, mm */
const SIMPLIFY_TOLERANCE = 0.01
/** Half length of a projected sketch axis, mm */
const AXIS_REACH = 500
const PICK_PX = 8

export type Fitted =
  | { kind: 'line'; from: Vec2; to: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }
  /** Counter-clockwise from `from` to `to` */
  | { kind: 'arc'; center: Vec2; from: Vec2; to: Vec2 }
  | { kind: 'polyline'; points: Vec2[] }

function distanceToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const length = dist(a, b)
  if (length < 1e-12) return dist(p, a)
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length
}

/** Douglas-Peucker: drops points closer than the tolerance to the simplified line */
function simplify(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return points
  let index = 0
  let max = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToLine(points[i]!, points[0]!, points[points.length - 1]!)
    if (d > max) {
      max = d
      index = i
    }
  }
  if (max <= tolerance) return [points[0]!, points[points.length - 1]!]
  const left = simplify(points.slice(0, index + 1), tolerance)
  const right = simplify(points.slice(index), tolerance)
  return [...left.slice(0, -1), ...right]
}

/** Recognises a projected polyline as a line, circle, arc or - failing that - a polyline */
export function fitPolyline(raw: Vec2[]): Fitted | undefined {
  const points = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]!) > 1e-9)
  if (points.length < 2) return undefined
  const first = points[0]!
  const last = points[points.length - 1]!
  const closed = points.length > 3 && dist(first, last) < 1e-6

  if (!closed && points.every((p) => distanceToLine(p, first, last) <= FIT_TOLERANCE)) {
    // An edge seen end-on projects to a point; that is nothing to draw
    return dist(first, last) < 1e-6 ? undefined : { kind: 'line', from: first, to: last }
  }

  if (points.length >= 3) {
    const a = points[0]!
    const b = points[Math.floor(points.length / 3)]!
    const c = points[Math.floor((2 * points.length) / 3)]!
    const center = circleThrough(a, b, c)
    if (center) {
      const radius = dist(center, a)
      if (points.every((p) => Math.abs(dist(center, p) - radius) <= FIT_TOLERANCE * Math.max(1, radius / 10))) {
        if (closed) return { kind: 'circle', center, radius }
        // Which way the edge runs around the centre decides the arc's start
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return cross > 0 ? { kind: 'arc', center, from: first, to: last } : { kind: 'arc', center, from: last, to: first }
      }
    }
  }
  return { kind: 'polyline', points: simplify(points, SIMPLIFY_TOLERANCE) }
}

/** Creates fixed reference geometry for a fitted curve */
export function addReference(editor: SketchEditor, fitted: Fitted, construction = false): SketchCurve[] {
  const point = (at: Vec2) => editor.pointAt(at, 1e-6) ?? editor.point(at)
  let curves: SketchCurve[]
  switch (fitted.kind) {
    case 'line':
      curves = [editor.line(point(fitted.from), point(fitted.to), construction)]
      break
    case 'circle':
      curves = [editor.circle(point(fitted.center), fitted.radius, construction)]
      break
    case 'arc': {
      const arc = editor.arc(point(fitted.center), point(fitted.from), point(fitted.to))
      arc.construction = construction
      curves = [arc]
      break
    }
    case 'polyline': {
      const points = fitted.points.map(point)
      curves = points.slice(1).map((p, i) => editor.line(points[i]!, p, construction))
    }
  }
  for (const curve of curves) {
    curve.reference = true
    editor.constraint(ConstraintKind.Fix, [], [curve])
  }
  return curves
}

type Target = { kind: 'edge'; points: Vec2[] } | { kind: 'axis'; axis: 'X' | 'Y' }

export class ProjectTool extends Tool {
  readonly id = 'project'
  private target: Target | undefined

  hint() {
    return 'Körperkante oder Skizzenachse anklicken – wird als fixierte Referenz übernommen'
  }

  override snapped() {
    return undefined
  }

  override picked(): EObject[] {
    return []
  }

  override move(e: ToolPointer) {
    super.move(e)
    this.target = this.targetAt(e)
  }

  override down(e: ToolPointer) {
    if (e.button !== 0) return
    const target = this.targetAt(e)
    if (!target) return
    const editor = this.ctx.editor
    if (target.kind === 'axis') {
      const [from, to]: [Vec2, Vec2] = target.axis === 'X' ? [[-AXIS_REACH, 0], [AXIS_REACH, 0]] : [[0, -AXIS_REACH], [0, AXIS_REACH]]
      // Axes become construction references: they guide but do not split profiles
      this.record('Achse projizieren', () => addReference(editor, { kind: 'line', from, to }, true))
      return
    }
    const fitted = fitPolyline(target.points)
    if (!fitted) {
      this.ctx.notifier.info('Die Kante steht senkrecht auf der Skizzenebene – projiziert ist sie nur ein Punkt')
      return
    }
    this.record('Kante projizieren', () => addReference(editor, fitted))
  }

  override preview(): Preview[] {
    const target = this.target
    if (!target) return []
    if (target.kind === 'axis') {
      const reach = this.ctx.px(2000)
      return [target.axis === 'X' ? { kind: 'line', a: [-reach, 0], b: [reach, 0] } : { kind: 'line', a: [0, -reach], b: [0, reach] }]
    }
    return [{ kind: 'polyline', points: target.points }]
  }

  private targetAt(e: ToolPointer): Target | undefined {
    const tolerance = this.ctx.px(PICK_PX)
    let best: Target | undefined
    let bestDistance = tolerance
    for (const points of this.ctx.bodyEdges()) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!
        const b = points[i]!
        const ab: Vec2 = [b[0] - a[0], b[1] - a[1]]
        const length2 = ab[0] ** 2 + ab[1] ** 2
        const t = length2 ? Math.max(0, Math.min(1, ((e.at[0] - a[0]) * ab[0] + (e.at[1] - a[1]) * ab[1]) / length2)) : 0
        const d = dist(e.at, [a[0] + ab[0] * t, a[1] + ab[1] * t])
        if (d < bestDistance) {
          bestDistance = d
          best = { kind: 'edge', points }
        }
      }
    }
    if (best) return best
    if (Math.abs(e.at[1]) < tolerance) return { kind: 'axis', axis: 'X' }
    if (Math.abs(e.at[0]) < tolerance) return { kind: 'axis', axis: 'Y' }
    return undefined
  }
}
