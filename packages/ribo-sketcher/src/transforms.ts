/**
 * Sketch tools that derive geometry from existing curves: mirror, offset and
 * the rectangular and circular patterns.
 */

import type { EObject } from '@emfts/core'
import type { Vec2 } from 'ribo-contracts'
import {
  ConstraintKind,
  DimensionKind,
  isArc,
  isCircle,
  isLine,
  isSketchCurve,
  type SketchArc,
  type SketchCurve,
  type SketchLine,
  type SketchPoint,
} from 'ribo-model'
import { dist, pos } from './SketchEditor'
import { Tool, type Field, type Preview, type ToolContext, type ToolPointer } from './tools'

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const unit = (a: Vec2): Vec2 => {
  const length = Math.hypot(a[0], a[1])
  return length < 1e-12 ? [1, 0] : [a[0] / length, a[1] / length]
}
const fmt = (value: number) => Number(value.toFixed(2)).toString()
const angleOf = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])

/** How a curve looks after a point transform, for previews */
function previewCurve(curve: SketchCurve, transform: (p: Vec2) => Vec2, mirrors = false): Preview[] {
  if (isLine(curve)) return [{ kind: 'line', a: transform(pos(curve.start)), b: transform(pos(curve.end)), construction: curve.construction }]
  if (isCircle(curve)) return [{ kind: 'circle', c: transform(pos(curve.center)), r: curve.radius, construction: curve.construction }]
  if (isArc(curve)) {
    const c = transform(pos(curve.center))
    const [s, e] = mirrors ? [transform(pos(curve.end)), transform(pos(curve.start))] : [transform(pos(curve.start)), transform(pos(curve.end))]
    return [{ kind: 'arc', c, r: dist(c, s), from: angleOf(c, s), to: angleOf(c, e) }]
  }
  return []
}

/** Base for tools that first collect curves - preloaded from the selection - and then act on them */
abstract class CurvesTool extends Tool {
  protected curves = new Set<SketchCurve>()
  protected collecting = true

  constructor(ctx: ToolContext) {
    super(ctx)
    for (const object of ctx.selection.get()) if (isSketchCurve(object)) this.curves.add(object)
    if (this.curves.size) this.collecting = false
  }

  override picked(): EObject[] {
    return [...this.curves]
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    if (this.collecting) {
      const hit = this.ctx.hit(e.screen)
      if (hit?.kind !== 'curve') return
      if (this.curves.has(hit.curve)) this.curves.delete(hit.curve)
      else this.curves.add(hit.curve)
      return
    }
    this.act(e)
  }

  override enter() {
    if (this.collecting && this.curves.size) this.collecting = false
  }

  override escape() {
    if (!this.collecting) {
      this.collecting = true
      return true
    }
    if (!this.curves.size) return false
    this.curves.clear()
    return true
  }

  protected collectHint(next: string) {
    return this.curves.size
      ? `${this.curves.size} Kurve(n) gewählt · weitere anklicken · Enter: ${next}`
      : 'Kurven anklicken, die übernommen werden sollen'
  }

  protected abstract act(e: ToolPointer): void
}

// ------------------------------------------------------------------ mirror

export class MirrorTool extends CurvesTool {
  readonly id = 'mirror'
  private axis: SketchLine | undefined

  hint() {
    return this.collecting ? this.collectHint('weiter zur Spiegellinie') : 'Spiegellinie anklicken'
  }

  override move(e: ToolPointer) {
    super.move(e)
    const hit = this.collecting ? undefined : this.ctx.hit(e.screen)
    this.axis = hit?.kind === 'curve' && isLine(hit.curve) && !this.curves.has(hit.curve) ? hit.curve : undefined
  }

  override snapped() {
    return undefined
  }

  override preview(): Preview[] {
    const axis = this.axis
    if (!axis) return []
    const reflect = this.reflection(axis)
    return [...this.curves].flatMap((c) => previewCurve(c, reflect, true))
  }

  private reflection(axis: SketchLine) {
    const a = pos(axis.start)
    const d = unit(sub(pos(axis.end), a))
    return (p: Vec2): Vec2 => {
      const v = sub(p, a)
      const foot = add(a, mul(d, dot(v, d)))
      return sub(mul(foot, 2), p)
    }
  }

  protected act() {
    const axis = this.axis
    if (!axis) return
    const reflect = this.reflection(axis)
    const editor = this.ctx.editor
    const onAxis = (p: SketchPoint) => dist(reflect(pos(p)), pos(p)) < 1e-6
    this.record('Spiegeln', () => {
      const { points } = editor.copy([...this.curves], reflect, true, onAxis)
      // Symmetric constraints keep the copy a mirror image when the original changes
      for (const [original, copy] of points) editor.constraint(ConstraintKind.Symmetric, [original, copy], [axis])
      editor.document.solveSketch(editor.sketch)
    })
    this.curves.clear()
    this.collecting = true
    this.ctx.setTool('select')
  }
}

// ------------------------------------------------------------------ offset

interface Segment {
  curve: SketchCurve
  forward: boolean
}

export class OffsetTool extends Tool {
  readonly id = 'offset'
  private chain: Segment[] = []
  private side: Vec2 | undefined

  hint() {
    return this.chain.length ? 'Seite mit der Maus wählen, klicken oder Abstand eintippen' : 'Kurve anklicken – verbundene Kurven werden mitgenommen'
  }

  override fields(): Field[] {
    if (!this.chain.length) return []
    const s = this.side ? this.signedDistance(this.side) : 0
    return [{ label: 'Abstand', placeholder: fmt(Math.abs(s)) }]
  }

  override picked(): EObject[] {
    return this.chain.map((s) => s.curve)
  }

  override move(e: ToolPointer) {
    super.move(e)
    this.side = e.at
  }

  override snapped() {
    return undefined
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    if (!this.chain.length) {
      const hit = this.ctx.hit(e.screen)
      if (hit?.kind === 'curve') this.chain = this.ctx.editor.chain(hit.curve)
      return
    }
    const s = this.signedDistance(e.at)
    if (Math.abs(s) > this.ctx.px(1)) this.create(s, undefined)
  }

  override apply([distance]: string[]) {
    if (!this.chain.length || !this.side) return
    const sign = Math.sign(this.signedDistance(this.side)) || 1
    try {
      const value = distance ? this.evaluate(distance) : Math.abs(this.signedDistance(this.side))
      if (value > 0) this.create(sign * value, distance || undefined)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override escape() {
    if (!this.chain.length) return false
    this.chain = []
    return true
  }

  override preview(): Preview[] {
    if (!this.chain.length || !this.side) return []
    const offset = this.offsetGeometry(this.signedDistance(this.side))
    return offset.flatMap((o): Preview[] =>
      o.kind === 'line'
        ? [{ kind: 'line', a: o.from, b: o.to }]
        : o.kind === 'circle'
          ? [{ kind: 'circle', c: o.center, r: o.radius }]
          : [{ kind: 'arc', c: o.center, r: o.radius, from: angleOf(o.center, o.ccwFrom), to: angleOf(o.center, o.ccwTo) }],
    )
  }

  /** Distance of a point to the chain, positive on the left of the direction of travel */
  private signedDistance(p: Vec2): number {
    let best = Infinity
    let signed = 0
    for (const { curve, forward } of this.chain) {
      if (isLine(curve)) {
        const [a, b] = forward ? [pos(curve.start), pos(curve.end)] : [pos(curve.end), pos(curve.start)]
        const d = unit(sub(b, a))
        const t = Math.max(0, Math.min(dist(a, b), dot(sub(p, a), d)))
        const distance = dist(add(a, mul(d, t)), p)
        if (distance < best) {
          best = distance
          signed = dot(sub(p, a), [-d[1], d[0]])
        }
      } else if (isCircle(curve) || isArc(curve)) {
        const c = pos(curve.center)
        const r = isCircle(curve) ? curve.radius : dist(c, pos(curve.start))
        const distance = Math.abs(dist(c, p) - r)
        if (distance < best) {
          best = distance
          // Travelling counter-clockwise the centre is on the left
          const ccw = isCircle(curve) || forward
          signed = ccw ? r - dist(c, p) : dist(c, p) - r
        }
      }
    }
    return signed
  }

  /** The offset of each segment, joined where neighbours meet */
  private offsetGeometry(s: number) {
    type Piece =
      | { kind: 'line'; from: Vec2; to: Vec2 }
      | { kind: 'arc'; center: Vec2; radius: number; from: Vec2; to: Vec2; ccwFrom: Vec2; ccwTo: Vec2; forward: boolean }
      | { kind: 'circle'; center: Vec2; radius: number }
    const pieces: Piece[] = this.chain.map(({ curve, forward }): Piece => {
      if (isLine(curve)) {
        const [a, b] = forward ? [pos(curve.start), pos(curve.end)] : [pos(curve.end), pos(curve.start)]
        const d = unit(sub(b, a))
        const n: Vec2 = [-d[1], d[0]]
        return { kind: 'line', from: add(a, mul(n, s)), to: add(b, mul(n, s)) }
      }
      if (isCircle(curve)) return { kind: 'circle', center: pos(curve.center), radius: Math.max(1e-6, curve.radius - s) }
      const arc = curve as SketchArc
      const c = pos(arc.center)
      const r = dist(c, pos(arc.start))
      const radius = Math.max(1e-6, forward ? r - s : r + s)
      const scale = (p: Vec2) => add(c, mul(unit(sub(p, c)), radius))
      const [ccwFrom, ccwTo] = [scale(pos(arc.start)), scale(pos(arc.end))]
      return { kind: 'arc', center: c, radius, ccwFrom, ccwTo, from: forward ? ccwFrom : ccwTo, to: forward ? ccwTo : ccwFrom, forward }
    })
    // Lines meeting at a corner: extend or trim both to their intersection
    const closed = this.isClosed()
    for (let i = 0; i < pieces.length; i++) {
      const j = i + 1 < pieces.length ? i + 1 : closed ? 0 : -1
      if (j < 0) continue
      const p = pieces[i]!
      const q = pieces[j]!
      if (p.kind !== 'line' || q.kind !== 'line') continue
      const corner = intersectLines(p.from, p.to, q.from, q.to)
      if (corner) {
        p.to = corner
        q.from = corner
      }
    }
    return pieces
  }

  private isClosed(): boolean {
    if (this.chain.length < 2) return false
    const endOf = ({ curve, forward }: Segment) => {
      const c = curve as SketchLine | SketchArc
      return forward ? c.end : c.start
    }
    const startOf = ({ curve, forward }: Segment) => {
      const c = curve as SketchLine | SketchArc
      return forward ? c.start : c.end
    }
    return endOf(this.chain[this.chain.length - 1]!) === startOf(this.chain[0]!)
  }

  private create(s: number, expression: string | undefined) {
    const pieces = this.offsetGeometry(s)
    const editor = this.ctx.editor
    const chain = this.chain
    this.record('Versatz', () => {
      // One point per joint, shared by the neighbouring pieces
      const joints: SketchPoint[] = []
      const point = (at: Vec2) => {
        const near = joints.find((j) => dist(pos(j), at) < 1e-6)
        if (near) return near
        const created = editor.point(at)
        joints.push(created)
        return created
      }
      const created: SketchCurve[] = []
      pieces.forEach((piece, i) => {
        const original = chain[i]!.curve
        if (piece.kind === 'line') {
          const line = editor.line(point(piece.from), point(piece.to))
          editor.constraint(ConstraintKind.Parallel, [], [original, line])
          created.push(line)
        } else if (piece.kind === 'circle') {
          created.push(editor.circle((original as SketchArc).center, piece.radius))
        } else {
          // Sharing the centre point keeps the arc concentric
          created.push(editor.arc((original as SketchArc).center, point(piece.ccwFrom), point(piece.ccwTo)))
        }
      })
      const firstLine = created.findIndex((c) => isLine(c))
      if (firstLine >= 0) {
        const original = chain[firstLine]!.curve
        const line = created[firstLine]!
        const label = mul(add(pos((line as SketchLine).start), pos((original as SketchLine).end)), 0.5)
        editor.tryAdd(() => editor.dimension(DimensionKind.Distance, [], [original, line], expression ?? fmt(Math.abs(s)), label))
      }
      editor.document.solveSketch(editor.sketch)
    })
    this.chain = []
  }
}

function intersectLines(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | undefined {
  const r = sub(a2, a1)
  const q = sub(b2, b1)
  const denom = r[0] * q[1] - r[1] * q[0]
  if (Math.abs(denom) < 1e-12) return undefined
  const t = ((b1[0] - a1[0]) * q[1] - (b1[1] - a1[1]) * q[0]) / denom
  return add(a1, mul(r, t))
}

// ----------------------------------------------------------------- patterns

export class RectangularPatternTool extends CurvesTool {
  readonly id = 'rectPattern'
  private values = { nx: 3, dx: 10, ny: 1, dy: 10 }

  hint() {
    return this.collecting ? this.collectHint('weiter zu Anzahl und Abstand') : 'Anzahl und Abstand eintippen (Tab wechselt) · Enter erzeugt das Muster'
  }

  override fields(): Field[] {
    if (this.collecting) return []
    const v = this.values
    return [
      { label: 'Anzahl X', placeholder: String(v.nx) },
      { label: 'Abstand X', placeholder: fmt(v.dx) },
      { label: 'Anzahl Y', placeholder: String(v.ny) },
      { label: 'Abstand Y', placeholder: fmt(v.dy) },
    ]
  }

  override preview(): Preview[] {
    if (this.collecting) return []
    return this.offsets().flatMap((o) => [...this.curves].flatMap((c) => previewCurve(c, (p) => add(p, o))))
  }

  override apply(typed: string[]) {
    if (this.collecting) return
    try {
      const [nx, dx, ny, dy] = typed.map((t) => (t ? this.evaluate(t) : undefined))
      this.values = {
        nx: Math.max(1, Math.round(nx ?? this.values.nx)),
        dx: dx ?? this.values.dx,
        ny: Math.max(1, Math.round(ny ?? this.values.ny)),
        dy: dy ?? this.values.dy,
      }
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
      return
    }
    const offsets = this.offsets()
    if (!offsets.length) return
    const editor = this.ctx.editor
    this.record('Rechteckiges Muster', () => {
      for (const o of offsets) editor.copy([...this.curves], (p) => add(p, o))
    })
    this.curves.clear()
    this.collecting = true
    this.ctx.setTool('select')
  }

  protected act() {}

  /** Translations of the copies; the original stays where it is */
  private offsets(): Vec2[] {
    const { nx, dx, ny, dy } = this.values
    const result: Vec2[] = []
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (i || j) result.push([i * dx, j * dy])
    return result
  }
}

export class CircularPatternTool extends CurvesTool {
  readonly id = 'circPattern'
  private center: Vec2 | undefined
  private values = { count: 6, angle: 360 }

  hint() {
    if (this.collecting) return this.collectHint('weiter zum Mittelpunkt')
    if (!this.center) return 'Mittelpunkt des Musters klicken'
    return 'Anzahl und Gesamtwinkel eintippen · Enter erzeugt das Muster'
  }

  override fields(): Field[] {
    if (this.collecting || !this.center) return []
    return [
      { label: 'Anzahl', placeholder: String(this.values.count) },
      { label: 'Winkel', placeholder: `${this.values.angle}` },
    ]
  }

  override escape() {
    if (this.center) {
      this.center = undefined
      return true
    }
    return super.escape()
  }

  protected act(e: ToolPointer) {
    if (!this.center) this.center = this.ctx.snap(e.at).at
  }

  override preview(): Preview[] {
    if (this.collecting || !this.center) return []
    return this.rotations().flatMap((rotate) => [...this.curves].flatMap((c) => previewCurve(c, rotate)))
  }

  override apply(typed: string[]) {
    if (!this.center) return
    try {
      const [count, angle] = typed.map((t) => (t ? this.evaluate(t) : undefined))
      this.values = { count: Math.max(2, Math.round(count ?? this.values.count)), angle: angle ?? this.values.angle }
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
      return
    }
    const rotations = this.rotations()
    const editor = this.ctx.editor
    this.record('Kreisförmiges Muster', () => {
      for (const rotate of rotations) editor.copy([...this.curves], rotate)
    })
    this.curves.clear()
    this.center = undefined
    this.collecting = true
    this.ctx.setTool('select')
  }

  private rotations(): ((p: Vec2) => Vec2)[] {
    const c = this.center!
    const { count, angle } = this.values
    // A full turn has no copy on top of the original; a partial one ends on its last angle
    const step = ((angle >= 360 ? angle / count : angle / Math.max(1, count - 1)) * Math.PI) / 180
    return [...Array(count - 1).keys()].map((i) => {
      const a = step * (i + 1)
      const [cos, sin] = [Math.cos(a), Math.sin(a)]
      return (p: Vec2): Vec2 => {
        const v = sub(p, c)
        return [c[0] + v[0] * cos - v[1] * sin, c[1] + v[0] * sin + v[1] * cos]
      }
    })
  }
}
