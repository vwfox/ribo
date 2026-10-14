/**
 * The sketch tools. Each is a small state machine fed with pointer events in
 * sketch coordinates; what it would create next it reports as a preview.
 * Every change to the model happens inside one history step.
 */

import type { EObject } from '@emfts/core'
import type { DocumentService, Notifier, SketchView, Vec2 } from 'ribo-contracts'
import { closestPoint, crossings } from 'ribo-geometry'
import {
  ConstraintKind,
  DimensionKind,
  isArc,
  isCircle,
  isLine,
  isSketchCurve,
  isSketchPoint,
  type Dimension,
  type SketchArc,
  type SketchCircle,
  type SketchCurve,
  type SketchLine,
  type SketchPoint,
} from 'ribo-model'
import { measure } from './annotations'
import { dist, planCurve, pos, type SketchEditor, type Snap } from './SketchEditor'

export type Preview =
  | { kind: 'line'; a: Vec2; b: Vec2; construction?: boolean }
  | { kind: 'circle'; c: Vec2; r: number; construction?: boolean }
  /** Counter-clockwise */
  | { kind: 'arc'; c: Vec2; r: number; from: number; to: number }
  | { kind: 'text'; at: Vec2; text: string }
  | { kind: 'polyline'; points: Vec2[] }
  | { kind: 'box'; a: Vec2; b: Vec2 }

export interface Field {
  label: string
  /** Shown when the user has typed nothing */
  placeholder?: string
}

export interface ToolPointer {
  /** Sketch coordinates */
  at: Vec2
  screen: Vec2
  shift: boolean
  button: number
}

export type Hit =
  | { kind: 'point'; point: SketchPoint }
  | { kind: 'curve'; curve: SketchCurve; at: Vec2 }
  | { kind: 'dimension'; dimension: Dimension }
  | { kind: 'glyph'; constraint: EObject }

export interface ToolContext {
  editor: SketchEditor
  document: DocumentService
  notifier: Notifier
  view(): SketchView
  /** Screen pixels to millimetres */
  px(pixels: number): number
  snap(at: Vec2, skip?: Set<SketchPoint>): Snap
  hit(screen: Vec2): Hit | undefined
  selection: { get(): Set<EObject>; set(objects: Set<EObject>): void }
  setTool(id: string): void
  editDimension(dimension: Dimension): void
  /** Edges of the bodies, projected onto the sketch plane, as polylines in sketch coordinates */
  bodyEdges(): Vec2[][]
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const unit = (a: Vec2): Vec2 => {
  const length = Math.hypot(a[0], a[1])
  return length < 1e-12 ? [1, 0] : [a[0] / length, a[1] / length]
}
const fmt = (value: number) => Number(value.toFixed(2)).toString()

export abstract class Tool {
  abstract readonly id: string
  /** Last pointer position, snapped */
  protected cursor: Snap | undefined

  constructor(protected readonly ctx: ToolContext) {}

  abstract hint(): string
  fields(): Field[] {
    return []
  }
  /** Typed values, as expressions; called on Enter */
  apply(_values: string[]): void {}
  down(_e: ToolPointer): void {}
  move(e: ToolPointer): void {
    this.cursor = this.ctx.snap(e.at, this.skip())
  }
  up(_e: ToolPointer): void {}
  dblclick(_e: ToolPointer): void {}
  /** Enter without a value field: the tool's next step */
  enter(): void {}
  /** Objects the tool has picked so far, highlighted by the overlay */
  picked(): EObject[] {
    return []
  }
  /** Escape: true when the tool had something to cancel */
  escape(): boolean {
    return false
  }
  preview(): Preview[] {
    return []
  }
  /** The snap target under the cursor, for the snap marker */
  snapped(): Snap | undefined {
    return this.cursor
  }
  /** Points the snapping must ignore (the ones being placed) */
  protected skip(): Set<SketchPoint> {
    return new Set()
  }

  protected evaluate(expression: string): number {
    return this.ctx.document.evaluate(expression)
  }

  protected record<T>(label: string, change: () => T): T {
    return this.ctx.document.history.record(label, change)
  }
}

// ------------------------------------------------------------------ select

type Drag =
  | { kind: 'point'; point: SketchPoint }
  | { kind: 'line'; line: SketchLine; last: Vec2 }
  | { kind: 'circle'; circle: SketchCircle }
  | { kind: 'label'; dimension: Dimension }
  | { kind: 'box'; from: Vec2; to: Vec2 }

export class SelectTool extends Tool {
  readonly id = 'select'
  private pressed: { e: ToolPointer; hit: Hit | undefined } | undefined
  private drag: Drag | undefined

  hint() {
    return 'Klicken wählt aus · Ziehen verschiebt · Doppelklick auf Bemaßung ändert den Wert · Entf löscht'
  }

  override down(e: ToolPointer) {
    if (e.button !== 0) return
    this.pressed = { e, hit: this.ctx.hit(e.screen) }
  }

  override move(e: ToolPointer) {
    super.move(e)
    const pressed = this.pressed
    if (!pressed) return
    if (!this.drag) {
      if (dist(pressed.e.screen, e.screen) < 4) return
      this.drag = this.startDrag(pressed)
      if (this.drag && this.drag.kind !== 'box') this.ctx.document.history.begin('Verschieben')
    }
    const drag = this.drag
    if (!drag) return
    const document = this.ctx.document
    switch (drag.kind) {
      case 'point':
        document.dragPoint(drag.point, e.at[0], e.at[1])
        break
      case 'line': {
        const delta = sub(e.at, drag.last)
        drag.last = e.at
        for (const point of new Set([drag.line.start, drag.line.end])) {
          if (point.origin) continue
          point.x += delta[0]
          point.y += delta[1]
        }
        document.solveSketch(this.ctx.editor.sketch)
        break
      }
      case 'circle':
        drag.circle.radius = Math.max(this.ctx.px(2), dist(pos(drag.circle.center), e.at))
        document.solveSketch(this.ctx.editor.sketch)
        break
      case 'label':
        drag.dimension.labelX = e.at[0]
        drag.dimension.labelY = e.at[1]
        break
      case 'box':
        drag.to = e.at
        break
    }
  }

  override up(e: ToolPointer) {
    const pressed = this.pressed
    const drag = this.drag
    this.pressed = undefined
    this.drag = undefined
    if (!pressed) return
    if (drag?.kind === 'box') {
      this.boxSelect(drag.from, drag.to, e.shift)
      return
    }
    if (drag) {
      this.ctx.document.history.end()
      return
    }
    const hit = pressed.hit
    const object = !hit ? undefined : hit.kind === 'point' ? hit.point : hit.kind === 'curve' ? hit.curve : hit.kind === 'dimension' ? hit.dimension : hit.constraint
    const selection = new Set(e.shift ? this.ctx.selection.get() : [])
    if (object) {
      if (e.shift && selection.has(object)) selection.delete(object)
      else selection.add(object)
    }
    this.ctx.selection.set(selection)
  }

  override dblclick(e: ToolPointer) {
    const hit = this.ctx.hit(e.screen)
    if (hit?.kind === 'dimension') this.ctx.editDimension(hit.dimension)
  }

  override escape() {
    if (this.ctx.selection.get().size === 0) return false
    this.ctx.selection.set(new Set())
    return true
  }

  override preview(): Preview[] {
    return this.drag?.kind === 'box' ? [{ kind: 'box', a: this.drag.from, b: this.drag.to }] : []
  }

  override snapped() {
    return undefined
  }

  private startDrag(pressed: { e: ToolPointer; hit: Hit | undefined }): Drag | undefined {
    const hit = pressed.hit
    if (!hit) return { kind: 'box', from: pressed.e.at, to: pressed.e.at }
    if (hit.kind === 'point') return hit.point.origin ? undefined : { kind: 'point', point: hit.point }
    if (hit.kind === 'dimension') return { kind: 'label', dimension: hit.dimension }
    if (hit.kind === 'curve') {
      const curve = hit.curve
      if (isLine(curve)) return { kind: 'line', line: curve, last: pressed.e.at }
      if (isCircle(curve)) return { kind: 'circle', circle: curve }
      if (isArc(curve)) {
        const nearer = dist(pos(curve.start), pressed.e.at) < dist(pos(curve.end), pressed.e.at) ? curve.start : curve.end
        return { kind: 'point', point: nearer }
      }
    }
    return undefined
  }

  private boxSelect(a: Vec2, b: Vec2, extend: boolean) {
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
    const inside = (p: SketchPoint) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
    const selection = new Set<EObject>(extend ? this.ctx.selection.get() : [])
    const editor = this.ctx.editor
    for (const point of editor.points()) if (!point.origin && inside(point)) selection.add(point)
    for (const curve of editor.curves()) {
      const points = isLine(curve) ? [curve.start, curve.end] : isArc(curve) ? [curve.start, curve.end, curve.center] : isCircle(curve) ? [curve.center] : []
      const fits = isCircle(curve)
        ? curve.center.x - curve.radius >= x0 && curve.center.x + curve.radius <= x1 && curve.center.y - curve.radius >= y0 && curve.center.y + curve.radius <= y1
        : points.every(inside)
      if (fits) selection.add(curve)
    }
    this.ctx.selection.set(selection)
  }
}

// -------------------------------------------------------------------- line

export class LineTool extends Tool {
  readonly id = 'line'
  private last: SketchPoint | undefined
  private first: SketchPoint | undefined

  hint() {
    return this.last ? 'Nächsten Punkt klicken · Länge eintippen · Esc beendet die Linienkette' : 'Startpunkt klicken'
  }

  override fields(): Field[] {
    return this.last ? [{ label: 'Länge', placeholder: this.cursor ? fmt(dist(pos(this.last), this.cursor.at)) : '' }] : []
  }

  protected override skip() {
    return new Set(this.last ? [this.last] : [])
  }

  override down(e: ToolPointer) {
    if (e.button === 2) {
      this.escape()
      return
    }
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at, this.skip())
    const editor = this.ctx.editor
    if (!this.last) {
      this.record('Linie', () => {
        this.last = this.first = editor.resolve(snap)
      })
      return
    }
    if (snap.kind === 'point' && snap.point === this.last) return
    if (dist(snap.at, pos(this.last)) < this.ctx.px(2)) return
    this.record('Linie', () => {
      const end = editor.resolve(snap)
      const line = editor.line(this.last!, end)
      editor.inferAxis(line)
      this.continueFrom(end, snap.kind === 'point')
    })
  }

  override dblclick() {
    this.escape()
  }

  override apply([length]: string[]) {
    const start = this.last
    if (!start || !length) return
    let value: number
    try {
      value = this.evaluate(length)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
      return
    }
    if (value <= 0) return
    const dir = unit(sub(this.cursor?.at ?? add(pos(start), [1, 0]), pos(start)))
    const editor = this.ctx.editor
    this.record('Linie', () => {
      const end = editor.point(add(pos(start), mul(dir, value)))
      const line = editor.line(start, end)
      editor.inferAxis(line)
      const label = add(add(pos(start), mul(dir, value / 2)), mul([-dir[1], dir[0]], this.ctx.px(24)))
      editor.tryAdd(() => editor.dimension(DimensionKind.Distance, [], [line], length, label))
      this.last = end
    })
  }

  override escape() {
    if (!this.last) return false
    const last = this.last
    this.record('Linie', () => this.ctx.editor.dropIfUnused(last))
    this.last = this.first = undefined
    return true
  }

  override preview(): Preview[] {
    if (!this.last || !this.cursor) return []
    const a = pos(this.last)
    const b = this.cursor.at
    const d = sub(b, a)
    const angle = Math.abs((Math.atan2(d[1], d[0]) * 180) / Math.PI)
    const axis = angle < 2 || angle > 178 ? ' H' : Math.abs(angle - 90) < 2 ? ' V' : ''
    return [
      { kind: 'line', a, b },
      { kind: 'text', at: add(mul(add(a, b), 0.5), [0, this.ctx.px(14)]), text: `${fmt(dist(a, b))} mm${axis}` },
    ]
  }

  private continueFrom(end: SketchPoint, snappedToExisting: boolean) {
    // Closing the chain, or ending on existing geometry, ends the chain
    if (end === this.first || snappedToExisting) {
      this.last = this.first = undefined
    } else {
      this.last = end
    }
  }
}

// --------------------------------------------------------------- rectangle

export class RectangleTool extends Tool {
  private anchor: Snap | undefined

  constructor(
    ctx: ToolContext,
    readonly id: 'rectangle' | 'centerRectangle',
  ) {
    super(ctx)
  }

  private get centered() {
    return this.id === 'centerRectangle'
  }

  hint() {
    if (!this.anchor) return this.centered ? 'Mittelpunkt klicken' : 'Erste Ecke klicken'
    return 'Gegenüberliegende Ecke klicken · Breite und Höhe eintippen (Tab wechselt)'
  }

  override fields(): Field[] {
    if (!this.anchor || !this.cursor) return this.anchor ? [{ label: 'Breite' }, { label: 'Höhe' }] : []
    const [w, h] = this.size(this.cursor.at)
    return [
      { label: 'Breite', placeholder: fmt(Math.abs(w)) },
      { label: 'Höhe', placeholder: fmt(Math.abs(h)) },
    ]
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (!this.anchor) {
      this.anchor = snap
      return
    }
    this.create(snap, undefined)
  }

  override apply(values: string[]) {
    if (!this.anchor) return
    const cursor = this.cursor?.at ?? add(this.anchor.at, [1, 1])
    const [w0, h0] = this.size(cursor)
    try {
      const w = values[0] ? this.evaluate(values[0]) : Math.abs(w0)
      const h = values[1] ? this.evaluate(values[1]) : Math.abs(h0)
      if (w <= 0 || h <= 0) return
      const sx = w0 < 0 ? -1 : 1
      const sy = h0 < 0 ? -1 : 1
      const reach = this.centered ? [(sx * w) / 2, (sy * h) / 2] : [sx * w, sy * h]
      this.create({ kind: 'free', at: add(this.anchor.at, reach as Vec2) }, values)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override escape() {
    if (!this.anchor) return false
    this.anchor = undefined
    return true
  }

  override preview(): Preview[] {
    if (!this.anchor || !this.cursor) return []
    const [a, b, c, d] = this.corners(this.cursor.at)
    const [w, h] = this.size(this.cursor.at)
    return [
      { kind: 'polyline', points: [a, b, c, d, a] },
      { kind: 'text', at: add(mul(add(a, b), 0.5), [0, -this.ctx.px(14)]), text: fmt(Math.abs(w)) },
      { kind: 'text', at: add(mul(add(b, c), 0.5), [this.ctx.px(22), 0]), text: fmt(Math.abs(h)) },
    ]
  }

  private size(to: Vec2): Vec2 {
    const d = sub(to, this.anchor!.at)
    return this.centered ? mul(d, 2) : d
  }

  private corners(to: Vec2): [Vec2, Vec2, Vec2, Vec2] {
    const anchor = this.anchor!.at
    const [x0, y0] = this.centered ? sub(anchor, sub(to, anchor)) : anchor
    const [x1, y1] = to
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
  }

  private create(opposite: Snap, typed: string[] | undefined) {
    const anchor = this.anchor!
    const corners = this.corners(opposite.at)
    const [w, h] = this.size(opposite.at)
    if (Math.abs(w) < this.ctx.px(2) || Math.abs(h) < this.ctx.px(2)) return
    const editor = this.ctx.editor
    this.record('Rechteck', () => {
      let points: SketchPoint[]
      let center: SketchPoint | undefined
      if (this.centered) {
        center = editor.resolve(anchor)
        points = corners.map((c) => editor.point(c))
      } else {
        points = [editor.resolve(anchor), editor.point(corners[1]!), opposite.kind === 'free' ? editor.point(corners[2]!) : editor.resolve(opposite), editor.point(corners[3]!)]
      }
      const lines = points.map((p, i) => editor.line(p, points[(i + 1) % 4]!))
      editor.constraint(ConstraintKind.Horizontal, [], [lines[0]!])
      editor.constraint(ConstraintKind.Vertical, [], [lines[1]!])
      editor.constraint(ConstraintKind.Horizontal, [], [lines[2]!])
      editor.constraint(ConstraintKind.Vertical, [], [lines[3]!])
      if (center) {
        const diagonal = editor.line(points[0]!, points[2]!, true)
        editor.constraint(ConstraintKind.Midpoint, [center], [diagonal])
      }
      if (typed?.[0]) {
        const label = add(mul(add(corners[0]!, corners[1]!), 0.5), [0, -this.ctx.px(26) * Math.sign(h || 1)])
        editor.tryAdd(() => editor.dimension(DimensionKind.Distance, [], [lines[0]!], typed[0]!, label))
      }
      if (typed?.[1]) {
        const label = add(mul(add(corners[1]!, corners[2]!), 0.5), [this.ctx.px(30) * Math.sign(w || 1), 0])
        editor.tryAdd(() => editor.dimension(DimensionKind.Distance, [], [lines[1]!], typed[1]!, label))
      }
      editor.document.solveSketch(editor.sketch)
    })
    this.anchor = undefined
  }
}

// ------------------------------------------------------------------ circle

export class CircleTool extends Tool {
  readonly id = 'circle'
  private center: Snap | undefined

  hint() {
    return this.center ? 'Punkt auf dem Kreis klicken · Durchmesser eintippen' : 'Mittelpunkt klicken'
  }

  override fields(): Field[] {
    if (!this.center) return []
    return [{ label: 'Durchmesser', placeholder: this.cursor ? fmt(2 * dist(this.center.at, this.cursor.at)) : '' }]
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (!this.center) {
      this.center = snap
      return
    }
    const r = dist(this.center.at, snap.at)
    if (r < this.ctx.px(2)) return
    this.create(r, undefined, snap)
  }

  override apply([diameter]: string[]) {
    if (!this.center || !diameter) return
    try {
      const value = this.evaluate(diameter)
      if (value > 0) this.create(value / 2, diameter, undefined)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override escape() {
    if (!this.center) return false
    this.center = undefined
    return true
  }

  override preview(): Preview[] {
    if (!this.center || !this.cursor) return []
    const r = dist(this.center.at, this.cursor.at)
    return [
      { kind: 'circle', c: this.center.at, r },
      { kind: 'line', a: this.center.at, b: this.cursor.at, construction: true },
      { kind: 'text', at: add(this.cursor.at, [this.ctx.px(12), this.ctx.px(12)]), text: `⌀${fmt(2 * r)}` },
    ]
  }

  private create(r: number, diameter: string | undefined, through: Snap | undefined) {
    const anchor = this.center!
    const editor = this.ctx.editor
    this.record('Kreis', () => {
      const circle = editor.circle(editor.resolve(anchor), r)
      if (through?.kind === 'point') editor.tryAdd(() => editor.constraint(ConstraintKind.Coincident, [through.point], [circle]), '')
      if (diameter) {
        const label = add(anchor.at, [r * 0.8 + this.ctx.px(20), r * 0.8 + this.ctx.px(20)])
        editor.tryAdd(() => editor.dimension(DimensionKind.Diameter, [], [circle], diameter, label))
      }
    })
    this.center = undefined
  }
}

// --------------------------------------------------------------------- arc

/** Centre of the circle through three points, or undefined when they are collinear */
export function circleThrough(a: Vec2, b: Vec2, c: Vec2): Vec2 | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return undefined
  const a2 = a[0] ** 2 + a[1] ** 2
  const b2 = b[0] ** 2 + b[1] ** 2
  const c2 = c[0] ** 2 + c[1] ** 2
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d]
}

/** Is the angle of m inside the counter-clockwise sweep from s to e (all around c)? */
function ccwContains(c: Vec2, s: Vec2, e: Vec2, m: Vec2): boolean {
  const angle = (p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])
  const norm = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return norm(angle(m) - angle(s)) < norm(angle(e) - angle(s))
}

export class ArcTool extends Tool {
  readonly id = 'arc'
  private start: Snap | undefined
  private end: Snap | undefined

  hint() {
    if (!this.start) return 'Startpunkt des Bogens klicken'
    if (!this.end) return 'Endpunkt klicken'
    return 'Punkt auf dem Bogen klicken'
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (!this.start) this.start = snap
    else if (!this.end) {
      if (dist(snap.at, this.start.at) > this.ctx.px(2)) this.end = snap
    } else this.create(snap.at)
  }

  override escape() {
    if (!this.start) return false
    this.start = this.end = undefined
    return true
  }

  override preview(): Preview[] {
    if (!this.start || !this.cursor) return []
    if (!this.end) return [{ kind: 'line', a: this.start.at, b: this.cursor.at, construction: true }]
    const c = circleThrough(this.start.at, this.end.at, this.cursor.at)
    if (!c) return [{ kind: 'line', a: this.start.at, b: this.end.at }]
    const [s, e] = ccwContains(c, this.start.at, this.end.at, this.cursor.at) ? [this.start.at, this.end.at] : [this.end.at, this.start.at]
    const angle = (p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])
    return [
      { kind: 'arc', c, r: dist(c, s), from: angle(s), to: angle(e) },
      { kind: 'text', at: add(this.cursor.at, [this.ctx.px(12), this.ctx.px(12)]), text: `R${fmt(dist(c, s))}` },
    ]
  }

  private create(through: Vec2) {
    const c = circleThrough(this.start!.at, this.end!.at, through)
    if (!c) return
    const forward = ccwContains(c, this.start!.at, this.end!.at, through)
    const editor = this.ctx.editor
    const [start, end] = [this.start!, this.end!]
    this.record('Bogen', () => {
      const center = editor.point(c)
      const s = editor.resolve(start)
      const e = editor.resolve(end)
      if (forward) editor.arc(center, s, e)
      else editor.arc(center, e, s)
      editor.document.solveSketch(editor.sketch)
    })
    this.start = this.end = undefined
  }
}

// ----------------------------------------------------------------- polygon

export class PolygonTool extends Tool {
  readonly id = 'polygon'
  private center: Snap | undefined
  private sides = 6

  hint() {
    return this.center ? `Ecke klicken (${this.sides} Seiten) · Durchmesser und Seitenzahl eintippen` : 'Mittelpunkt des Polygons klicken'
  }

  override fields(): Field[] {
    if (!this.center) return []
    return [
      { label: 'Umkreis-Ø', placeholder: this.cursor ? fmt(2 * dist(this.center.at, this.cursor.at)) : '' },
      { label: 'Seiten', placeholder: String(this.sides) },
    ]
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (!this.center) {
      this.center = snap
      return
    }
    if (dist(snap.at, this.center.at) < this.ctx.px(2)) return
    this.create(snap.at, undefined)
  }

  override apply([diameter, sides]: string[]) {
    if (!this.center) return
    try {
      if (sides) {
        const n = Math.round(this.evaluate(sides))
        if (n >= 3 && n <= 64) this.sides = n
      }
      const toward = this.cursor?.at ?? add(this.center.at, [0, 1])
      if (!diameter) {
        this.create(toward, undefined)
        return
      }
      const d = this.evaluate(diameter)
      if (d <= 0) return
      this.create(add(this.center.at, mul(unit(sub(toward, this.center.at)), d / 2)), diameter)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override escape() {
    if (!this.center) return false
    this.center = undefined
    return true
  }

  private vertices(corner: Vec2): Vec2[] {
    const c = this.center!.at
    const r = dist(c, corner)
    const a0 = Math.atan2(corner[1] - c[1], corner[0] - c[0])
    return [...Array(this.sides).keys()].map((i) => {
      const a = a0 + (2 * Math.PI * i) / this.sides
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Vec2
    })
  }

  override preview(): Preview[] {
    if (!this.center || !this.cursor) return []
    const vertices = this.vertices(this.cursor.at)
    return [
      { kind: 'polyline', points: [...vertices, vertices[0]!] },
      { kind: 'circle', c: this.center.at, r: dist(this.center.at, this.cursor.at), construction: true },
    ]
  }

  private create(corner: Vec2, diameter: string | undefined) {
    const anchor = this.center!
    const vertices = this.vertices(corner)
    const r = dist(anchor.at, corner)
    const editor = this.ctx.editor
    this.record('Polygon', () => {
      const center = editor.resolve(anchor)
      const circle = editor.circle(center, r, true)
      const points = vertices.map((v) => editor.point(v))
      const lines = points.map((p, i) => editor.line(p, points[(i + 1) % points.length]!))
      for (const point of points) editor.constraint(ConstraintKind.Coincident, [point], [circle])
      for (const line of lines.slice(1)) editor.constraint(ConstraintKind.Equal, [], [lines[0]!, line])
      if (diameter) editor.tryAdd(() => editor.dimension(DimensionKind.Diameter, [], [circle], diameter, add(anchor.at, [r + this.ctx.px(24), r + this.ctx.px(24)])))
      editor.document.solveSketch(editor.sketch)
    })
    this.center = undefined
  }
}

// -------------------------------------------------------------------- slot

export class SlotTool extends Tool {
  readonly id = 'slot'
  private first: Snap | undefined
  private second: Snap | undefined

  hint() {
    if (!this.first) return 'Ersten Mittelpunkt des Langlochs klicken'
    if (!this.second) return 'Zweiten Mittelpunkt klicken'
    return 'Breite festlegen: klicken oder eintippen'
  }

  override fields(): Field[] {
    return this.second ? [{ label: 'Breite', placeholder: this.cursor ? fmt(2 * this.halfWidth(this.cursor.at)) : '' }] : []
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (!this.first) this.first = snap
    else if (!this.second) {
      if (dist(snap.at, this.first.at) > this.ctx.px(2)) this.second = snap
    } else this.create(this.halfWidth(e.at), undefined)
  }

  override apply([width]: string[]) {
    if (!this.second || !width) return
    try {
      const value = this.evaluate(width)
      if (value > 0) this.create(value / 2, width)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override escape() {
    if (!this.first) return false
    this.first = this.second = undefined
    return true
  }

  private halfWidth(at: Vec2): number {
    const a = this.first!.at
    const d = unit(sub(this.second!.at, a))
    return Math.max(this.ctx.px(2), Math.abs((at[0] - a[0]) * -d[1] + (at[1] - a[1]) * d[0]))
  }

  override preview(): Preview[] {
    if (!this.first || !this.cursor) return []
    if (!this.second) return [{ kind: 'line', a: this.first.at, b: this.cursor.at, construction: true }]
    const r = this.halfWidth(this.cursor.at)
    const [c1, c2] = [this.first.at, this.second.at]
    const d = unit(sub(c2, c1))
    const n: Vec2 = [-d[1], d[0]]
    const angle = Math.atan2(d[1], d[0])
    return [
      { kind: 'line', a: add(c1, mul(n, -r)), b: add(c2, mul(n, -r)) },
      { kind: 'line', a: add(c2, mul(n, r)), b: add(c1, mul(n, r)) },
      { kind: 'arc', c: c2, r, from: angle - Math.PI / 2, to: angle + Math.PI / 2 },
      { kind: 'arc', c: c1, r, from: angle + Math.PI / 2, to: angle + (3 * Math.PI) / 2 },
    ]
  }

  private create(r: number, width: string | undefined) {
    const [first, second] = [this.first!, this.second!]
    const d = unit(sub(second.at, first.at))
    const n: Vec2 = [-d[1], d[0]]
    const editor = this.ctx.editor
    this.record('Langloch', () => {
      const c1 = editor.resolve(first)
      const c2 = editor.resolve(second)
      const a1 = editor.point(add(first.at, mul(n, r)))
      const a2 = editor.point(add(second.at, mul(n, r)))
      const b1 = editor.point(add(first.at, mul(n, -r)))
      const b2 = editor.point(add(second.at, mul(n, -r)))
      const bottom = editor.line(b1, b2)
      const top = editor.line(a2, a1)
      const end2 = editor.arc(c2, b2, a2)
      const end1 = editor.arc(c1, a1, b1)
      editor.line(c1, c2, true)
      for (const line of [bottom, top]) {
        editor.constraint(ConstraintKind.Tangent, [], [line, end1])
        editor.constraint(ConstraintKind.Tangent, [], [line, end2])
      }
      editor.constraint(ConstraintKind.Equal, [], [end1, end2])
      if (width) editor.tryAdd(() => editor.dimension(DimensionKind.Diameter, [], [end1], width, add(first.at, mul(d, -r - this.ctx.px(30)))))
      editor.document.solveSketch(editor.sketch)
    })
    this.first = this.second = undefined
  }
}

// ------------------------------------------------------------------- point

export class PointTool extends Tool {
  readonly id = 'point'

  hint() {
    return 'Punkt setzen'
  }

  override down(e: ToolPointer) {
    if (e.button !== 0) return
    const snap = this.ctx.snap(e.at)
    if (snap.kind === 'point') return
    this.record('Punkt', () => this.ctx.editor.resolve(snap))
  }
}

// ------------------------------------------------------------------ fillet

export class FilletTool extends Tool {
  readonly id = 'fillet'
  private radius = '2'
  private corner: SketchPoint | undefined

  hint() {
    return `Ecke zweier Linien klicken (Radius ${this.radius} mm) · Radius eintippen`
  }

  override fields(): Field[] {
    return [{ label: 'Radius', placeholder: this.radius }]
  }

  override apply([radius]: string[]) {
    if (radius) this.radius = radius
  }

  override move(e: ToolPointer) {
    super.move(e)
    const point = this.ctx.editor.pointAt(e.at, this.ctx.px(10))
    this.corner = point && this.linesAt(point).length === 2 ? point : undefined
  }

  override down(e: ToolPointer) {
    if (e.button !== 0 || !this.corner) return
    try {
      this.fillet(this.corner)
    } catch (error) {
      this.ctx.notifier.error((error as Error).message)
    }
  }

  override preview(): Preview[] {
    if (!this.corner) return []
    return [{ kind: 'circle', c: pos(this.corner), r: this.ctx.px(8) }]
  }

  override snapped() {
    return undefined
  }

  private linesAt(point: SketchPoint): SketchLine[] {
    return this.ctx.editor.curves().filter((c): c is SketchLine => isLine(c) && (c.start === point || c.end === point))
  }

  private fillet(corner: SketchPoint) {
    const [l1, l2] = this.linesAt(corner) as [SketchLine, SketchLine]
    const r = this.evaluate(this.radius)
    if (r <= 0) throw new Error('Der Radius muss größer als 0 sein')
    const p = pos(corner)
    const far = (l: SketchLine) => pos(l.start === corner ? l.end : l.start)
    const d1 = unit(sub(far(l1), p))
    const d2 = unit(sub(far(l2), p))
    const angle = Math.acos(Math.min(1, Math.max(-1, d1[0] * d2[0] + d1[1] * d2[1])))
    if (angle < 1e-3 || Math.PI - angle < 1e-3) throw new Error('Die Linien liegen auf einer Geraden')
    const t = r / Math.tan(angle / 2)
    if (t >= dist(p, far(l1)) || t >= dist(p, far(l2))) throw new Error('Der Radius ist für diese Ecke zu groß')
    const t1 = add(p, mul(d1, t))
    const t2 = add(p, mul(d2, t))
    const c = add(p, mul(unit(add(d1, d2)), r / Math.sin(angle / 2)))
    const editor = this.ctx.editor
    this.record('Abrunden', () => {
      const p1 = editor.point(t1)
      const p2 = editor.point(t2)
      const center = editor.point(c)
      for (const [line, point] of [
        [l1, p1],
        [l2, p2],
      ] as const) {
        if (line.start === corner) line.start = point
        else line.end = point
      }
      const cross = (t1[0] - c[0]) * (t2[1] - c[1]) - (t1[1] - c[1]) * (t2[0] - c[0])
      const arc = cross > 0 ? editor.arc(center, p1, p2) : editor.arc(center, p2, p1)
      editor.constraint(ConstraintKind.Tangent, [], [l1, arc])
      editor.constraint(ConstraintKind.Tangent, [], [l2, arc])
      const outward = unit(sub(p, c))
      editor.tryAdd(() => editor.dimension(DimensionKind.Radius, [], [arc], this.radius, add(c, mul(outward, r + this.ctx.px(26)))))
      editor.dropIfUnused(corner)
      editor.document.solveSketch(editor.sketch)
    })
    this.corner = undefined
  }
}

// -------------------------------------------------------------------- trim

interface TrimPlan {
  curve: SketchCurve
  /** What stays: shorten from one side, split in two, or nothing */
  action:
    | { kind: 'delete' }
    | { kind: 'shorten'; side: 'start' | 'end'; at: Crossing }
    | { kind: 'split'; a: Crossing; b: Crossing }
  /** The piece that goes, for the preview */
  piece: Vec2[]
}

interface Crossing {
  point: Vec2
  other: SketchCurve
}

export class TrimTool extends Tool {
  readonly id = 'trim'
  private plan: TrimPlan | undefined

  hint() {
    return 'Kurvenstück zum Entfernen anklicken'
  }

  override move(e: ToolPointer) {
    super.move(e)
    const hit = this.ctx.editor.curveAt(e.at, this.ctx.px(8))
    this.plan = hit ? this.planTrim(hit.curve, e.at) : undefined
  }

  override down(e: ToolPointer) {
    if (e.button !== 0 || !this.plan) return
    const plan = this.plan
    this.record('Stutzen', () => this.trim(plan))
    this.plan = undefined
  }

  override preview(): Preview[] {
    return this.plan ? [{ kind: 'polyline', points: this.plan.piece }] : []
  }

  override snapped() {
    return undefined
  }

  private planTrim(curve: SketchCurve, at: Vec2): TrimPlan | undefined {
    const plan = planCurve(curve)
    if (!plan) return undefined
    const others = this.ctx.editor.curves().filter((c) => c !== curve)
    const otherPlans = others.map((c) => planCurve(c)!).filter(Boolean)
    const hit = closestPoint(plan, at)
    if (!hit) return undefined
    const range = curve && isLine(curve) ? 1 : isArc(curve) ? sweepOf(curve) : 2 * Math.PI
    const eps = 1e-6
    const all = crossings(plan, otherPlans).map((c) => ({ ...c, curve: others[c.other]! }))
    const inner = isCircle(curve) ? all : all.filter((c) => c.t > eps && c.t < range - eps)
    const sample = (t0: number, t1: number) => sampleCurve(curve, t0, t1)

    if (isCircle(curve)) {
      if (inner.length < 2) return { curve, action: { kind: 'delete' }, piece: sample(0, 2 * Math.PI) }
      const after = inner.find((c) => c.t > hit.t) ?? inner[0]!
      const before = [...inner].reverse().find((c) => c.t < hit.t) ?? inner[inner.length - 1]!
      const t1 = after.t > before.t ? after.t : after.t + 2 * Math.PI
      return {
        curve,
        // What remains runs counter-clockwise from `after` round to `before`
        action: { kind: 'split', a: { point: before.point, other: before.curve }, b: { point: after.point, other: after.curve } },
        piece: sample(before.t, t1),
      }
    }
    const before = [...inner].reverse().find((c) => c.t < hit.t)
    const after = inner.find((c) => c.t > hit.t)
    if (!before && !after) return { curve, action: { kind: 'delete' }, piece: sample(0, range) }
    if (!before) return { curve, action: { kind: 'shorten', side: 'start', at: { point: after!.point, other: after!.curve } }, piece: sample(0, after!.t) }
    if (!after) return { curve, action: { kind: 'shorten', side: 'end', at: { point: before.point, other: before.curve } }, piece: sample(before.t, range) }
    return {
      curve,
      action: { kind: 'split', a: { point: before.point, other: before.curve }, b: { point: after.point, other: after.curve } },
      piece: sample(before.t, after.t),
    }
  }

  /** The point at a crossing: an existing one there, or a new one held on the other curve */
  private pointAt(crossing: Crossing): SketchPoint {
    const editor = this.ctx.editor
    const existing = editor.pointAt(crossing.point, 1e-6)
    if (existing) return existing
    const point = editor.point(crossing.point)
    editor.constraint(ConstraintKind.Coincident, [point], [crossing.other])
    return point
  }

  private trim(plan: TrimPlan) {
    const editor = this.ctx.editor
    const { curve, action } = plan
    if (action.kind === 'delete') {
      this.ctx.document.remove(curve)
      return
    }
    if (isLine(curve) || isArc(curve)) {
      if (action.kind === 'shorten') {
        const point = this.pointAt(action.at)
        const old = action.side === 'start' ? curve.start : curve.end
        if (action.side === 'start') curve.start = point
        else curve.end = point
        editor.dropIfUnused(old)
      } else {
        const a = this.pointAt(action.a)
        const b = this.pointAt(action.b)
        const end = curve.end
        curve.end = a
        if (isLine(curve)) editor.line(b, end, curve.construction)
        else editor.arc((curve as SketchArc).center, b, end)
      }
    } else if (isCircle(curve) && action.kind === 'split') {
      // The circle becomes the arc that remains
      const start = this.pointAt(action.b)
      const end = this.pointAt(action.a)
      const arc = editor.arc(curve.center, start, end)
      arc.construction = curve.construction
      for (const constraint of editor.sketch.constraints.toArray()) {
        if (!constraint.curves.contains(curve)) continue
        const curves = constraint.curves.toArray().map((c) => (c === curve ? arc : c))
        constraint.curves.clear()
        curves.forEach((c) => constraint.curves.add(c))
      }
      editor.sketch.curves.remove(curve)
    }
    editor.document.solveSketch(editor.sketch)
  }
}

function sweepOf(arc: SketchArc): number {
  const a0 = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x)
  const a1 = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x)
  const sweep = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return sweep || 2 * Math.PI
}

function sampleCurve(curve: SketchCurve, t0: number, t1: number): Vec2[] {
  if (isLine(curve)) {
    const a = pos(curve.start)
    const b = pos(curve.end)
    return [add(a, mul(sub(b, a), t0)), add(a, mul(sub(b, a), t1))]
  }
  const c = pos((curve as SketchArc | SketchCircle).center)
  const r = isCircle(curve) ? curve.radius : dist(c, pos((curve as SketchArc).start))
  const base = isArc(curve) ? Math.atan2(curve.start.y - c[1], curve.start.x - c[0]) : 0
  const n = Math.max(4, Math.ceil(Math.abs(t1 - t0) * 16))
  return [...Array(n + 1).keys()].map((i) => {
    const a = base + t0 + ((t1 - t0) * i) / n
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Vec2
  })
}

// --------------------------------------------------------------- dimension

type Pick = SketchPoint | SketchCurve

export class DimensionTool extends Tool {
  readonly id = 'dimension'
  private picks: Pick[] = []
  private hover: Vec2 | undefined

  hint() {
    if (this.picks.length === 0) return 'Linie, Kreis, Bogen oder Punkt wählen'
    return 'Weiteres Element wählen oder Bemaßung platzieren'
  }

  override move(e: ToolPointer) {
    super.move(e)
    this.hover = e.at
  }

  override snapped() {
    return undefined
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const hit = this.ctx.hit(e.screen)
    const target = hit?.kind === 'point' ? hit.point : hit?.kind === 'curve' ? hit.curve : undefined
    if (target && !this.picks.includes(target)) {
      const next = [...this.picks, target]
      if (this.spec(next, e.at)) {
        this.picks = next
        return
      }
    }
    if (this.picks.length) this.place(e.at)
  }

  override escape() {
    if (!this.picks.length) return false
    this.picks = []
    return true
  }

  override preview(): Preview[] {
    const spec = this.hover && this.spec(this.picks, this.hover)
    if (!spec || !this.hover) return []
    const value = measure(spec.kind, spec.points, spec.curves)
    const previews: Preview[] = []
    for (const pick of this.picks) {
      if (isSketchPoint(pick)) previews.push({ kind: 'circle', c: pos(pick), r: this.ctx.px(5) })
    }
    if (value !== undefined) {
      const prefix = spec.kind === DimensionKind.Diameter ? '⌀' : spec.kind === DimensionKind.Radius ? 'R' : ''
      previews.push({ kind: 'text', at: this.hover, text: `${prefix}${fmt(value)}${spec.kind === DimensionKind.Angle ? '°' : ''}` })
    }
    return previews
  }

  /** Highlighted picks, for the overlay */
  override picked(): Pick[] {
    return this.picks
  }

  /** What the picks (with a label at `at`) would dimension, or undefined if they cannot be combined */
  private spec(picks: Pick[], at: Vec2): { kind: DimensionKind; points: SketchPoint[]; curves: SketchCurve[] } | undefined {
    const points = picks.filter(isSketchPoint)
    const curves = picks.filter(isSketchCurve)
    if (picks.length === 1 && points.length === 1) return { kind: DimensionKind.Distance, points, curves: [] }
    if (picks.length === 1) {
      const curve = curves[0]!
      if (isLine(curve)) return { kind: DimensionKind.Distance, points: [], curves }
      if (isCircle(curve)) return { kind: DimensionKind.Diameter, points: [], curves }
      if (isArc(curve)) return { kind: DimensionKind.Radius, points: [], curves }
    }
    if (picks.length === 2 && points.length === 2) {
      // Placed beside the pair the dimension is vertical, above or below it horizontal
      const [a, b] = points.map(pos) as [Vec2, Vec2]
      const inX = at[0] >= Math.min(a[0], b[0]) && at[0] <= Math.max(a[0], b[0])
      const inY = at[1] >= Math.min(a[1], b[1]) && at[1] <= Math.max(a[1], b[1])
      const kind = inX && !inY ? DimensionKind.HorizontalDistance : inY && !inX ? DimensionKind.VerticalDistance : DimensionKind.Distance
      return { kind, points, curves: [] }
    }
    if (picks.length === 2 && points.length === 1 && isLine(curves[0])) return { kind: DimensionKind.Distance, points, curves }
    if (picks.length === 2 && curves.length === 2 && isLine(curves[0]) && isLine(curves[1])) {
      const [l1, l2] = curves as [SketchLine, SketchLine]
      const d1 = unit(sub(pos(l1.end), pos(l1.start)))
      const d2 = unit(sub(pos(l2.end), pos(l2.start)))
      const parallel = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-3
      return { kind: parallel ? DimensionKind.Distance : DimensionKind.Angle, points: [], curves }
    }
    return undefined
  }

  private place(at: Vec2) {
    const spec = this.spec(this.picks, at)
    this.picks = []
    if (!spec || (spec.points.length === 1 && spec.curves.length === 0)) return
    const value = measure(spec.kind, spec.points, spec.curves)
    if (value === undefined) return
    const editor = this.ctx.editor
    let created: Dimension | undefined
    this.record('Bemaßung', () => {
      editor.tryAdd(() => {
        created = editor.dimension(spec.kind, spec.points, spec.curves, fmt(value), at)
        return created
      }, 'Diese Bemaßung würde die Skizze überbestimmen')
    })
    if (created && created.eContainer()) this.ctx.editDimension(created)
  }
}

// -------------------------------------------------------------- constraints

type ConstraintSpec = { kind: ConstraintKind; points: SketchPoint[]; curves: SketchCurve[] }

const round = (c: Pick | undefined) => isCircle(c) || isArc(c)

/** What a pick sequence means for a constraint tool: a constraint, 'more' picks needed, or invalid */
export function constraintSpec(kind: ConstraintKind | 'HV', picks: Pick[]): ConstraintSpec | 'more' | undefined {
  const points = picks.filter(isSketchPoint)
  const curves = picks.filter(isSketchCurve)
  const n = picks.length
  switch (kind) {
    case 'HV': {
      if (n === 1 && isLine(curves[0])) {
        const d = sub(pos(curves[0].end), pos(curves[0].start))
        return { kind: Math.abs(d[0]) >= Math.abs(d[1]) ? ConstraintKind.Horizontal : ConstraintKind.Vertical, points: [], curves }
      }
      if (n === 1 && points.length === 1) return 'more'
      if (n === 2 && points.length === 2) {
        const d = sub(pos(points[1]!), pos(points[0]!))
        return { kind: Math.abs(d[0]) >= Math.abs(d[1]) ? ConstraintKind.Horizontal : ConstraintKind.Vertical, points, curves: [] }
      }
      return undefined
    }
    case ConstraintKind.Coincident:
      if (n === 1) return 'more'
      if (n === 2 && points.length === 2) return { kind, points, curves: [] }
      if (n === 2 && points.length === 1) return { kind, points, curves }
      return undefined
    case ConstraintKind.Parallel:
    case ConstraintKind.Perpendicular:
    case ConstraintKind.Collinear:
      if (n === 1 && isLine(curves[0])) return 'more'
      if (n === 2 && curves.length === 2 && curves.every((c) => isLine(c))) return { kind, points: [], curves }
      return undefined
    case ConstraintKind.Equal:
      if (n === 1 && curves.length === 1) return 'more'
      if (n === 2 && curves.length === 2 && (curves.every((c) => isLine(c)) || curves.every(round))) return { kind, points: [], curves }
      return undefined
    case ConstraintKind.Tangent:
      if (n === 1 && curves.length === 1) return 'more'
      if (n === 2 && curves.length === 2 && curves.some(round)) return { kind, points: [], curves }
      return undefined
    case ConstraintKind.Concentric:
      if (n === 1 && round(curves[0])) return 'more'
      if (n === 2 && curves.length === 2 && curves.every(round)) return { kind, points: [], curves }
      return undefined
    case ConstraintKind.Midpoint:
      if (n === 1) return 'more'
      if (n === 2 && points.length === 1 && isLine(curves[0])) return { kind, points, curves }
      return undefined
    case ConstraintKind.Fix:
      if (n === 1) return { kind, points, curves }
      return undefined
    case ConstraintKind.Symmetric:
      if (n < 3 && curves.length === 0) return 'more'
      if (n === 3 && points.length === 2 && isLine(curves[0])) return { kind, points, curves }
      return undefined
  }
  return undefined
}

export class ConstraintTool extends Tool {
  private picks: Pick[] = []

  constructor(
    ctx: ToolContext,
    readonly id: string,
    private readonly kind: ConstraintKind | 'HV',
    private readonly label: string,
    private readonly instructions: string,
  ) {
    super(ctx)
  }

  hint() {
    return `${this.label}: ${this.instructions}`
  }

  /** Applies to a matching selection at once; true when it did */
  applyTo(selection: Pick[]): boolean {
    const spec = constraintSpec(this.kind, selection)
    if (!spec || spec === 'more') return false
    this.add(spec)
    return true
  }

  override down(e: ToolPointer) {
    if (e.button === 2) return void this.escape()
    if (e.button !== 0) return
    const hit = this.ctx.hit(e.screen)
    const target = hit?.kind === 'point' ? hit.point : hit?.kind === 'curve' ? hit.curve : undefined
    if (!target || this.picks.includes(target)) return
    const picks = [...this.picks, target]
    const spec = constraintSpec(this.kind, picks)
    if (!spec) {
      this.ctx.notifier.info(`${this.label}: ${this.instructions}`)
      this.picks = []
      return
    }
    if (spec === 'more') {
      this.picks = picks
      return
    }
    this.picks = []
    this.add(spec)
  }

  override escape() {
    if (!this.picks.length) return false
    this.picks = []
    return true
  }

  override snapped() {
    return undefined
  }

  override picked(): Pick[] {
    return this.picks
  }

  private add(spec: ConstraintSpec) {
    const editor = this.ctx.editor
    this.record(this.label, () => {
      if (spec.kind === ConstraintKind.Fix) {
        const existing = editor.fixOf(spec.points[0] ?? spec.curves[0]!)
        if (existing) {
          editor.sketch.constraints.remove(existing)
          return
        }
      }
      editor.tryAdd(() => editor.constraint(spec.kind, spec.points, spec.curves))
    })
  }
}
