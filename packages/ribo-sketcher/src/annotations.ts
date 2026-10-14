/**
 * Layout of dimensions and constraint glyphs in screen space. The overlay
 * draws from it and hit-tests against it, so both always agree.
 */

import { sketchToScreen, type SketchView, type Vec2 } from 'ribo-contracts'
import {
  ConstraintKind,
  DimensionKind,
  isArc,
  isCircle,
  isDimension,
  isGeometricConstraint,
  isLine,
  type Dimension,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
  type SketchLine,
  type SketchPoint,
} from 'ribo-model'
import { dist, pos } from './SketchEditor'

export interface DimensionLayout {
  dimension: Dimension
  /** Polylines to stroke, screen coordinates */
  lines: Vec2[][]
  /** Arrow tips with the direction they point in */
  arrows: { at: Vec2; dir: Vec2 }[]
  label: Vec2
  text: string
}

export interface GlyphLayout {
  constraint: SketchConstraint
  at: Vec2
  text: string
}

const GLYPHS: Partial<Record<ConstraintKind, string>> = {
  [ConstraintKind.Horizontal]: 'H',
  [ConstraintKind.Vertical]: 'V',
  [ConstraintKind.Parallel]: '∥',
  [ConstraintKind.Perpendicular]: '⊥',
  [ConstraintKind.Tangent]: 'T',
  [ConstraintKind.Equal]: '=',
  [ConstraintKind.Midpoint]: 'M',
  [ConstraintKind.Fix]: '⚲',
  [ConstraintKind.Symmetric]: '⇋',
  [ConstraintKind.Concentric]: '◎',
  [ConstraintKind.Collinear]: '≡',
  [ConstraintKind.Coincident]: '•',
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const unit = (a: Vec2): Vec2 => {
  const length = Math.hypot(a[0], a[1]) || 1
  return [a[0] / length, a[1] / length]
}
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]

/** Text of a dimension value: the number, and the expression when it is more than a number */
export function dimensionText(dimension: Dimension, value: number | undefined): string {
  const expression = (dimension.expression ?? '').trim()
  const number = value === undefined ? '?' : Number(value.toFixed(2)).toString()
  const prefix =
    dimension.kind === DimensionKind.Diameter ? '⌀' : dimension.kind === DimensionKind.Radius ? 'R' : ''
  const suffix = dimension.kind === DimensionKind.Angle ? '°' : ''
  const literal = /^-?\d+(\.\d+)?\s*(mm|deg|°)?$/.test(expression)
  return `${literal ? '' : 'fx: '}${prefix}${number}${suffix}`
}

/** The current measured value of what a dimension spans, in mm or degrees */
export function measure(kind: DimensionKind, points: SketchPoint[], curves: SketchCurve[]): number | undefined {
  const ends = endsOf(points, curves)
  switch (kind) {
    case DimensionKind.Distance:
      if (ends) return dist(pos(ends[0]), pos(ends[1]))
      if (points.length === 1 && isLine(curves[0])) return pointLineDistance(pos(points[0]!), curves[0])
      if (curves.length === 2 && isLine(curves[0]) && isLine(curves[1])) return pointLineDistance(pos(curves[1].start), curves[0])
      return undefined
    case DimensionKind.HorizontalDistance:
      return ends ? Math.abs(ends[1].x - ends[0].x) : undefined
    case DimensionKind.VerticalDistance:
      return ends ? Math.abs(ends[1].y - ends[0].y) : undefined
    case DimensionKind.Radius:
    case DimensionKind.Diameter: {
      const curve = curves[0]
      const r = isCircle(curve) ? curve.radius : isArc(curve) ? dist(pos(curve.center), pos(curve.start)) : undefined
      return r === undefined ? undefined : kind === DimensionKind.Diameter ? 2 * r : r
    }
    case DimensionKind.Angle: {
      if (!isLine(curves[0]) || !isLine(curves[1])) return undefined
      const d1 = unit(sub(pos(curves[0].end), pos(curves[0].start)))
      const d2 = unit(sub(pos(curves[1].end), pos(curves[1].start)))
      const angle = (Math.acos(Math.min(1, Math.max(-1, dot(d1, d2)))) * 180) / Math.PI
      return angle
    }
  }
  return undefined
}

/** Two points a linear dimension runs between: two points, or a line's ends */
function endsOf(points: SketchPoint[], curves: SketchCurve[]): [SketchPoint, SketchPoint] | undefined {
  if (points.length === 2) return [points[0]!, points[1]!]
  if (points.length === 0 && curves.length === 1 && isLine(curves[0]) && curves[0].start && curves[0].end) return [curves[0].start, curves[0].end]
  return undefined
}

function pointLineDistance(p: Vec2, line: SketchLine): number {
  const a = pos(line.start)
  const d = unit(sub(pos(line.end), a))
  const n: Vec2 = [-d[1], d[0]]
  return Math.abs(dot(sub(p, a), n))
}

function footOnLine(p: Vec2, line: SketchLine): Vec2 {
  const a = pos(line.start)
  const d = unit(sub(pos(line.end), a))
  return add(a, scale(d, dot(sub(p, a), d)))
}

/** Lays out one dimension; label in sketch coordinates is (labelX, labelY) */
export function layoutDimension(view: SketchView, dimension: Dimension, value: number | undefined): DimensionLayout | undefined {
  const S = (p: Vec2) => sketchToScreen(view, p)
  const points = dimension.points.toArray()
  const curves = dimension.curves.toArray()
  const label = S([dimension.labelX, dimension.labelY])
  const text = dimensionText(dimension, value)
  const lines: Vec2[][] = []
  const arrows: { at: Vec2; dir: Vec2 }[] = []

  const linear = (a: Vec2, b: Vec2, axis?: Vec2) => {
    // axis: direction the measurement runs along; aligned when not given
    const d = axis ?? unit(sub(b, a))
    if (Math.hypot(d[0], d[1]) < 1e-9) return
    const n: Vec2 = [-d[1], d[0]]
    const offsetA = dot(sub(label, a), n)
    const offsetB = dot(sub(label, b), n)
    const pa = add(a, scale(n, offsetA))
    const pb = add(b, scale(n, offsetB))
    const ext = (from: Vec2, to: Vec2) => {
      const dir = unit(sub(to, from))
      lines.push([add(from, scale(dir, 3)), add(to, scale(dir, 6))])
    }
    ext(a, pa)
    ext(b, pb)
    // The dimension line runs to the label when the label sits outside the span
    const along = (p: Vec2) => dot(sub(p, pa), d)
    const span = along(pb)
    const t = along(label)
    const start = Math.min(0, span, t)
    const end = Math.max(0, span, t)
    lines.push([add(pa, scale(d, start)), add(pa, scale(d, end))])
    const inward = span >= 0 ? d : scale(d, -1)
    arrows.push({ at: pa, dir: scale(inward, -1) }, { at: pb, dir: inward })
  }

  const ends = endsOf(points, curves)
  switch (dimension.kind) {
    case DimensionKind.Distance:
      if (ends) linear(S(pos(ends[0])), S(pos(ends[1])))
      else if (points.length === 1 && isLine(curves[0])) {
        linear(S(pos(points[0]!)), S(footOnLine(pos(points[0]!), curves[0])))
        lines.push([S(pos(curves[0].start)), S(pos(curves[0].end))])
      } else if (curves.length === 2 && isLine(curves[0]) && isLine(curves[1])) {
        const p = pos(curves[1].start)
        linear(S(p), S(footOnLine(p, curves[0])))
      } else return undefined
      break
    case DimensionKind.HorizontalDistance:
      if (!ends) return undefined
      linear(S(pos(ends[0])), S(pos(ends[1])), [1, 0])
      break
    case DimensionKind.VerticalDistance:
      if (!ends) return undefined
      linear(S(pos(ends[0])), S(pos(ends[1])), [0, 1])
      break
    case DimensionKind.Radius:
    case DimensionKind.Diameter: {
      const curve = curves[0]
      if (!isCircle(curve) && !isArc(curve)) return undefined
      const center = S(pos(curve.center))
      const r = (isCircle(curve) ? curve.radius : dist(pos(curve.center), pos(curve.start))) * view.scale
      const dir = unit(sub(label, center))
      const edge = add(center, scale(dir, r))
      if (dimension.kind === DimensionKind.Diameter) {
        const opposite = add(center, scale(dir, -r))
        lines.push([opposite, dist(label, center) > r ? label : edge])
        arrows.push({ at: edge, dir }, { at: opposite, dir: scale(dir, -1) })
      } else {
        lines.push([center, dist(label, center) > r ? label : edge])
        arrows.push({ at: edge, dir })
      }
      break
    }
    case DimensionKind.Angle: {
      const [l1, l2] = curves
      if (!isLine(l1) || !isLine(l2)) return undefined
      const a1 = S(pos(l1.start))
      const d1 = unit(sub(S(pos(l1.end)), a1))
      const a2 = S(pos(l2.start))
      const d2 = unit(sub(S(pos(l2.end)), a2))
      const cross = d1[0] * d2[1] - d1[1] * d2[0]
      if (Math.abs(cross) < 1e-9) return undefined
      const t = ((a2[0] - a1[0]) * d2[1] - (a2[1] - a1[1]) * d2[0]) / cross
      const vertex = add(a1, scale(d1, t))
      const radius = Math.max(dist(label, vertex), 12)
      // Of the four sectors the lines form, the one the label sits in
      const toLabel = unit(sub(label, vertex))
      let best: [Vec2, Vec2] = [d1, d2]
      let bestScore = -Infinity
      for (const u of [d1, scale(d1, -1)]) {
        for (const v of [d2, scale(d2, -1)]) {
          const score = dot(unit(add(u, v)), toLabel)
          if (score > bestScore) {
            bestScore = score
            best = [u, v]
          }
        }
      }
      const from = Math.atan2(best[0][1], best[0][0])
      let sweep = Math.atan2(best[1][1], best[1][0]) - from
      while (sweep > Math.PI) sweep -= 2 * Math.PI
      while (sweep < -Math.PI) sweep += 2 * Math.PI
      const arc: Vec2[] = []
      for (let i = 0; i <= 24; i++) {
        const a = from + (sweep * i) / 24
        arc.push([vertex[0] + radius * Math.cos(a), vertex[1] + radius * Math.sin(a)])
      }
      lines.push(arc)
      break
    }
    default:
      return undefined
  }
  return { dimension, lines, arrows, label, text }
}

/** Where on a curve its glyphs go, and which way is "outside" */
function glyphAnchor(view: SketchView, curve: SketchCurve): { at: Vec2; along: Vec2; normal: Vec2 } | undefined {
  const S = (p: Vec2) => sketchToScreen(view, p)
  if (isLine(curve) && curve.start && curve.end) {
    const a = S(pos(curve.start))
    const b = S(pos(curve.end))
    const along = unit(sub(b, a))
    return { at: scale(add(a, b), 0.5), along, normal: [along[1], -along[0]] }
  }
  if (isCircle(curve) && curve.center) {
    const c = S(pos(curve.center))
    const r = curve.radius * view.scale
    const dir: Vec2 = [Math.SQRT1_2, -Math.SQRT1_2]
    return { at: add(c, scale(dir, r)), along: [dir[1], -dir[0]], normal: dir }
  }
  if (isArc(curve) && curve.center && curve.start && curve.end) {
    const c = pos(curve.center)
    const a0 = Math.atan2(curve.start.y - c[1], curve.start.x - c[0])
    let a1 = Math.atan2(curve.end.y - c[1], curve.end.x - c[0])
    while (a1 <= a0) a1 += 2 * Math.PI
    const mid = (a0 + a1) / 2
    const r = dist(c, pos(curve.start))
    const at = S([c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid)])
    const normal = unit(sub(at, S(c)))
    return { at, along: [normal[1], -normal[0]], normal }
  }
  return undefined
}

/** Constraint glyphs next to the geometry they constrain, stacked along each curve */
export function layoutGlyphs(view: SketchView, sketch: Sketch): GlyphLayout[] {
  const result: GlyphLayout[] = []
  const perCurve = new Map<SketchCurve, number>()
  const perPoint = new Map<SketchPoint, number>()
  for (const constraint of sketch.constraints.toArray()) {
    if (!isGeometricConstraint(constraint)) continue
    const text = GLYPHS[constraint.kind]
    if (!text) continue
    const curves = constraint.curves.toArray()
    const points = constraint.points.toArray()
    // A point on a curve shows as the point itself; no glyph needed
    if (constraint.kind === ConstraintKind.Coincident && curves.length === 1) continue
    if (curves.length > 0 && constraint.kind !== ConstraintKind.Midpoint) {
      for (const curve of curves) {
        const anchor = glyphAnchor(view, curve)
        if (!anchor) continue
        const slot = perCurve.get(curve) ?? 0
        perCurve.set(curve, slot + 1)
        const shift = (slot - 0) * 15
        result.push({ constraint, text, at: add(add(anchor.at, scale(anchor.normal, 13)), scale(anchor.along, shift)) })
      }
    } else {
      for (const point of points) {
        const slot = perPoint.get(point) ?? 0
        perPoint.set(point, slot + 1)
        const at = sketchToScreen(view, pos(point))
        result.push({ constraint, text, at: [at[0] + 11 + slot * 14, at[1] - 11] })
      }
    }
  }
  return result
}

export function isDimensionConstraint(constraint: SketchConstraint): constraint is Dimension {
  return isDimension(constraint)
}
