/**
 * Sketch constraint solving with PlaneGCS (FreeCAD's 2D solver, as WASM).
 *
 * Each solve translates one sketch into solver primitives - points, then
 * curves, then constraints, ids ascending as PlaneGCS requires - solves, and
 * writes the moved points and radii back into the model.
 */

import { GcsWrapper, init_planegcs_module, DebugMode, SolveStatus } from '@salusoft89/planegcs'
import type { SketchPrimitive } from '@salusoft89/planegcs'
import {
  ConstraintKind,
  DimensionKind,
  isArc,
  isCircle,
  isDimension,
  isGeometricConstraint,
  isLine,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
  type SketchLine,
  type SketchPoint,
} from 'ribo-model'

/** Value of a dimension expression, in mm or degrees */
export type Evaluate = (expression: string) => number

export interface Drag {
  point: SketchPoint
  x: number
  y: number
}

export interface Underdefined {
  points: Set<SketchPoint>
  curves: Set<SketchCurve>
}

export interface SolveOutcome {
  ok: boolean
  /** Constraints the solver found in conflict */
  conflicting: SketchConstraint[]
  /** Dimensions whose expression could not be evaluated */
  invalid: SketchConstraint[]
  /** Remaining degrees of freedom */
  dof: number
}

type Primitive = SketchPrimitive & Record<string, unknown>

const WRITE_TOLERANCE = 1e-9

/** Translation of one sketch into solver primitives */
class Translation {
  readonly primitives: Primitive[] = []
  readonly pointIds = new Map<SketchPoint, string>()
  readonly curveIds = new Map<SketchCurve, string>()
  /** Solver constraint id -> model constraint */
  readonly owners = new Map<string, SketchConstraint>()
  readonly invalid: SketchConstraint[] = []
  private nextId = 1

  constructor(
    readonly sketch: Sketch,
    private readonly evaluate: Evaluate,
    fixed: Set<SketchPoint>,
  ) {
    for (const point of sketch.points.toArray()) {
      const id = this.id()
      this.pointIds.set(point, id)
      this.primitives.push({ id, type: 'point', x: point.x, y: point.y, fixed: point.origin || fixed.has(point) })
    }
    for (const curve of sketch.curves.toArray()) this.addCurve(curve)
    for (const constraint of sketch.constraints.toArray()) {
      try {
        for (const primitive of this.constraintPrimitives(constraint)) {
          const id = this.id()
          this.owners.set(id, constraint)
          this.primitives.push({ ...primitive, id } as Primitive)
        }
      } catch {
        this.invalid.push(constraint)
      }
    }
  }

  id(): string {
    return String(this.nextId++)
  }

  push(primitive: Omit<Primitive, 'id'>): string {
    const id = this.id()
    this.primitives.push({ ...primitive, id } as Primitive)
    return id
  }

  private point(point: SketchPoint | undefined): string {
    const id = point && this.pointIds.get(point)
    if (!id) throw new Error('Point is not part of the sketch')
    return id
  }

  private curve(curve: SketchCurve | undefined): string {
    const id = curve && this.curveIds.get(curve)
    if (!id) throw new Error('Curve is not part of the sketch')
    return id
  }

  private addCurve(curve: SketchCurve): void {
    if (isLine(curve)) {
      if (!curve.start || !curve.end) return
      const id = this.id()
      this.curveIds.set(curve, id)
      this.primitives.push({ id, type: 'line', p1_id: this.point(curve.start), p2_id: this.point(curve.end) } as Primitive)
    } else if (isCircle(curve)) {
      if (!curve.center) return
      const id = this.id()
      this.curveIds.set(curve, id)
      this.primitives.push({ id, type: 'circle', c_id: this.point(curve.center), radius: curve.radius } as Primitive)
    } else if (isArc(curve)) {
      if (!curve.center || !curve.start || !curve.end) return
      const { center: c, start: s, end: e } = curve
      const start = Math.atan2(s.y - c.y, s.x - c.x)
      let end = Math.atan2(e.y - c.y, e.x - c.x)
      while (end <= start) end += Math.PI * 2
      const id = this.id()
      this.curveIds.set(curve, id)
      this.primitives.push({
        id,
        type: 'arc',
        c_id: this.point(c),
        start_id: this.point(s),
        end_id: this.point(e),
        radius: Math.hypot(s.x - c.x, s.y - c.y),
        start_angle: start,
        end_angle: end,
      } as Primitive)
      this.push({ type: 'arc_rules', a_id: id } as Omit<Primitive, 'id'>)
    }
  }

  /** The solver constraints standing for one model constraint */
  private constraintPrimitives(constraint: SketchConstraint): Omit<Primitive, 'id'>[] {
    const points = constraint.points.toArray()
    const curves = constraint.curves.toArray()
    const P = (i: number) => this.point(points[i])
    const C = (i: number) => this.curve(curves[i])
    const kindOf = (c: SketchCurve | undefined) => (isLine(c) ? 'l' : isCircle(c) ? 'c' : isArc(c) ? 'a' : '?')
    const signature = curves.map(kindOf).join('')
    const prims = (...list: object[]) => list as Omit<Primitive, 'id'>[]

    if (isGeometricConstraint(constraint)) {
      switch (constraint.kind) {
        case ConstraintKind.Coincident:
          if (points.length === 2) return prims({ type: 'p2p_coincident', p1_id: P(0), p2_id: P(1) })
          if (signature === 'l') return prims({ type: 'point_on_line_pl', p_id: P(0), l_id: C(0) })
          if (signature === 'c') return prims({ type: 'point_on_circle', p_id: P(0), c_id: C(0) })
          if (signature === 'a') return prims({ type: 'point_on_arc', p_id: P(0), a_id: C(0) })
          break
        case ConstraintKind.Horizontal:
          if (signature === 'l') return prims({ type: 'horizontal_l', l_id: C(0) })
          if (points.length === 2) return prims({ type: 'horizontal_pp', p1_id: P(0), p2_id: P(1) })
          break
        case ConstraintKind.Vertical:
          if (signature === 'l') return prims({ type: 'vertical_l', l_id: C(0) })
          if (points.length === 2) return prims({ type: 'vertical_pp', p1_id: P(0), p2_id: P(1) })
          break
        case ConstraintKind.Parallel:
          if (signature === 'll') return prims({ type: 'parallel', l1_id: C(0), l2_id: C(1) })
          break
        case ConstraintKind.Perpendicular:
          if (signature === 'll') return prims({ type: 'perpendicular_ll', l1_id: C(0), l2_id: C(1) })
          break
        case ConstraintKind.Collinear:
          if (signature === 'll') {
            const second = curves[1] as SketchLine
            return prims(
              { type: 'parallel', l1_id: C(0), l2_id: C(1) },
              { type: 'point_on_line_pl', p_id: this.point(second.start), l_id: C(0) },
            )
          }
          break
        case ConstraintKind.Tangent: {
          const [a, b] = [C(0), C(1)]
          switch (signature) {
            case 'lc':
              return prims({ type: 'tangent_lc', l_id: a, c_id: b })
            case 'cl':
              return prims({ type: 'tangent_lc', l_id: b, c_id: a })
            case 'la':
              return prims({ type: 'tangent_la', l_id: a, a_id: b })
            case 'al':
              return prims({ type: 'tangent_la', l_id: b, a_id: a })
            case 'cc':
              return prims({ type: 'tangent_cc', c1_id: a, c2_id: b })
            case 'aa':
              return prims({ type: 'tangent_aa', a1_id: a, a2_id: b })
            case 'ca':
              return prims({ type: 'tangent_ca', c_id: a, a_id: b })
            case 'ac':
              return prims({ type: 'tangent_ca', c_id: b, a_id: a })
          }
          break
        }
        case ConstraintKind.Equal:
          switch (signature) {
            case 'll':
              return prims({ type: 'equal_length', l1_id: C(0), l2_id: C(1) })
            case 'cc':
              return prims({ type: 'equal_radius_cc', c1_id: C(0), c2_id: C(1) })
            case 'ca':
              return prims({ type: 'equal_radius_ca', c1_id: C(0), a2_id: C(1) })
            case 'ac':
              return prims({ type: 'equal_radius_ca', c1_id: C(1), a2_id: C(0) })
            case 'aa':
              return prims({ type: 'equal_radius_aa', a1_id: C(0), a2_id: C(1) })
          }
          break
        case ConstraintKind.Midpoint:
          if (signature === 'l') {
            return prims(
              { type: 'point_on_line_pl', p_id: P(0), l_id: C(0) },
              { type: 'point_on_perp_bisector_pl', p_id: P(0), l_id: C(0) },
            )
          }
          break
        case ConstraintKind.Symmetric:
          if (points.length === 2 && signature === 'l') return prims({ type: 'p2p_symmetric_ppl', p1_id: P(0), p2_id: P(1), l_id: C(0) })
          break
        case ConstraintKind.Concentric: {
          const centers = curves.map((c) => (isCircle(c) || isArc(c) ? c.center : undefined))
          if (centers.length === 2 && centers[0] && centers[1]) {
            return prims({ type: 'p2p_coincident', p1_id: this.point(centers[0]), p2_id: this.point(centers[1]) })
          }
          break
        }
        case ConstraintKind.Fix:
          // Applied by fixing the points in the constructor's caller
          return []
      }
      throw new Error(`Unsupported constraint ${constraint.kind} on ${signature || 'points'}`)
    }

    if (isDimension(constraint)) {
      const value = this.evaluate(constraint.expression ?? '')
      if (!Number.isFinite(value)) throw new Error('Invalid value')
      // A line stands for its two endpoints
      const ends = signature === 'l' && points.length === 0 ? [(curves[0] as SketchLine).start, (curves[0] as SketchLine).end] : points
      switch (constraint.kind) {
        case DimensionKind.Distance:
          if (value <= 0) throw new Error('Distance must be positive')
          if (ends.length === 2) return prims({ type: 'p2p_distance', p1_id: this.point(ends[0]), p2_id: this.point(ends[1]), distance: value })
          if (points.length === 1 && signature === 'l') return prims({ type: 'p2l_distance', p_id: P(0), l_id: C(0), distance: value })
          if (signature === 'll') {
            const second = curves[1] as SketchLine
            return prims({ type: 'p2l_distance', p_id: this.point(second.start), l_id: C(0), distance: value })
          }
          break
        case DimensionKind.HorizontalDistance:
        case DimensionKind.VerticalDistance: {
          if (ends.length !== 2) break
          const prop = constraint.kind === DimensionKind.HorizontalDistance ? 'x' : 'y'
          const [a, b] = ends as [SketchPoint, SketchPoint]
          const sign = b[prop] - a[prop] < 0 ? -1 : 1
          return prims({
            type: 'difference',
            param1: { o_id: this.point(a), prop },
            param2: { o_id: this.point(b), prop },
            difference: sign * value,
          })
        }
        case DimensionKind.Radius:
        case DimensionKind.Diameter: {
          if (value <= 0) throw new Error('Size must be positive')
          const diameter = constraint.kind === DimensionKind.Diameter
          if (signature === 'c') {
            return prims(diameter ? { type: 'circle_diameter', c_id: C(0), diameter: value } : { type: 'circle_radius', c_id: C(0), radius: value })
          }
          if (signature === 'a') {
            return prims(diameter ? { type: 'arc_diameter', a_id: C(0), diameter: value } : { type: 'arc_radius', a_id: C(0), radius: value })
          }
          break
        }
        case DimensionKind.Angle:
          if (signature === 'll') {
            const angle = closestAngle(curves[0] as SketchLine, curves[1] as SketchLine, (value * Math.PI) / 180)
            return prims({ type: 'l2l_angle_ll', l1_id: C(0), l2_id: C(1), angle })
          }
          break
      }
      throw new Error(`Unsupported dimension ${constraint.kind}`)
    }
    return []
  }
}

/** The signed variant of an angle closest to the lines' current angle, so solving does not flip them */
function closestAngle(l1: SketchLine, l2: SketchLine, angle: number): number {
  const d1 = [l1.end.x - l1.start.x, l1.end.y - l1.start.y]
  const d2 = [l2.end.x - l2.start.x, l2.end.y - l2.start.y]
  const current = Math.atan2(d1[0]! * d2[1]! - d1[1]! * d2[0]!, d1[0]! * d2[0]! + d1[1]! * d2[1]!)
  const candidates = [angle, -angle, Math.PI - angle, angle - Math.PI]
  const distance = (a: number) => Math.abs(Math.atan2(Math.sin(a - current), Math.cos(a - current)))
  return candidates.reduce((best, a) => (distance(a) < distance(best) ? a : best))
}

/** Points held by Fix constraints */
function fixedPoints(sketch: Sketch): Set<SketchPoint> {
  const fixed = new Set<SketchPoint>()
  for (const constraint of sketch.constraints.toArray()) {
    if (!isGeometricConstraint(constraint) || constraint.kind !== ConstraintKind.Fix) continue
    constraint.points.toArray().forEach((p) => fixed.add(p))
    for (const curve of constraint.curves.toArray()) {
      if (isLine(curve)) [curve.start, curve.end].forEach((p) => p && fixed.add(p))
      if (isCircle(curve) && curve.center) fixed.add(curve.center)
      if (isArc(curve)) [curve.center, curve.start, curve.end].forEach((p) => p && fixed.add(p))
    }
  }
  return fixed
}

export class SketchSolver {
  private constructor(private readonly gcs: GcsWrapper) {
    gcs.debug_mode = DebugMode.NoDebug
  }

  /** Loads the WASM module; `wasmUrl` is where the bundler put planegcs.wasm */
  static async create(wasmUrl?: string): Promise<SketchSolver> {
    const module = await init_planegcs_module(wasmUrl ? { locateFile: () => wasmUrl } : undefined)
    return new SketchSolver(new GcsWrapper(new module.GcsSystem()))
  }

  dispose(): void {
    this.gcs.destroy_gcs_module()
  }

  /**
   * Solves the sketch and writes the result into the model. With a drag, the
   * point is pulled towards (x, y) as far as the constraints allow.
   */
  solve(sketch: Sketch, evaluate: Evaluate, drag?: Drag): SolveOutcome {
    const translation = new Translation(sketch, evaluate, fixedPoints(sketch))
    const gcs = this.gcs
    gcs.clear_data()
    const primitives = [...translation.primitives]
    if (drag && translation.pointIds.has(drag.point)) {
      const p_id = translation.pointIds.get(drag.point)!
      let next = primitives.length + 1000
      primitives.push(
        { id: String(next++), type: 'coordinate_x', p_id, x: drag.x, temporary: true } as Primitive,
        { id: String(next++), type: 'coordinate_y', p_id, y: drag.y, temporary: true } as Primitive,
      )
    }
    gcs.push_primitives_and_params(primitives)
    const status = gcs.solve()
    const conflicting = [
      ...new Set(
        gcs
          .get_gcs_conflicting_constraints()
          .map((id) => translation.owners.get(id))
          .filter((c): c is SketchConstraint => c !== undefined),
      ),
    ]
    const ok = status === SolveStatus.Success || status === SolveStatus.Converged
    if (ok) {
      gcs.apply_solution()
      this.writeBack(translation)
    }
    return { ok, conflicting, invalid: translation.invalid, dof: (gcs.gcs as unknown as { dof(): number }).dof() }
  }

  /**
   * What the constraints do not pin down yet - what Fusion draws blue. A point
   * (or a circle's radius) is fully defined when fixing it adds no
   * information: the probing constraints come out redundant.
   */
  underdefined(sketch: Sketch, evaluate: Evaluate): Underdefined {
    const fixed = fixedPoints(sketch)
    const translation = new Translation(sketch, evaluate, fixed)
    const gcs = this.gcs
    const free: Underdefined = { points: new Set(), curves: new Set() }
    gcs.clear_data()
    gcs.push_primitives_and_params(translation.primitives)
    gcs.solve()
    if ((gcs.gcs as unknown as { dof(): number }).dof() === 0) return free

    const probe = (extra: Primitive[]): boolean => {
      gcs.clear_data()
      gcs.push_primitives_and_params([...translation.primitives, ...extra])
      gcs.solve()
      const redundant = new Set([...gcs.get_gcs_redundant_constraints(), ...gcs.get_gcs_partially_redundant_constraints()])
      return extra.every((p) => redundant.has(p.id as string))
    }
    let next = translation.primitives.length + 1000
    for (const [point, p_id] of translation.pointIds) {
      if (point.origin || fixed.has(point)) continue
      const determined = probe([
        { id: String(next++), type: 'coordinate_x', p_id, x: point.x } as Primitive,
        { id: String(next++), type: 'coordinate_y', p_id, y: point.y } as Primitive,
      ])
      if (!determined) free.points.add(point)
    }
    for (const [curve, c_id] of translation.curveIds) {
      const points = isLine(curve) ? [curve.start, curve.end] : isArc(curve) ? [curve.center, curve.start, curve.end] : isCircle(curve) ? [curve.center] : []
      let open = points.some((p) => p && free.points.has(p))
      if (!open && isCircle(curve)) {
        open = !probe([{ id: String(next++), type: 'circle_radius', c_id, radius: curve.radius } as Primitive])
      }
      if (open) free.curves.add(curve)
    }
    return free
  }

  private writeBack(translation: Translation): void {
    const solved = new Map(this.gcs.sketch_index.get_primitives().map((p) => [p.id, p as Primitive]))
    for (const [point, id] of translation.pointIds) {
      const p = solved.get(id) as { x: number; y: number } | undefined
      if (!p) continue
      if (Math.abs(point.x - p.x) > WRITE_TOLERANCE) point.x = p.x
      if (Math.abs(point.y - p.y) > WRITE_TOLERANCE) point.y = p.y
    }
    for (const [curve, id] of translation.curveIds) {
      if (!isCircle(curve)) continue
      const c = solved.get(id) as { radius: number } | undefined
      if (c && Math.abs(curve.radius - c.radius) > WRITE_TOLERANCE) curve.radius = c.radius
    }
  }
}
