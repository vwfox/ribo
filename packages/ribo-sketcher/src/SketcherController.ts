import { ref, shallowRef } from 'vue'
import type { EObject } from '@emfts/core'
import type { DocumentService, Frame, Notifier, SketcherService, SketchView, Vec2, ViewportService } from 'ribo-contracts'
import { screenToSketch } from 'ribo-contracts'
import { IDENTITY, applyDirection, applyPoint, worldToFrame } from 'ribo-geometry'
import { ConstraintKind, isSketchCurve, isSketchPoint, sketchOf, type ConstructionPlane, type Dimension, type Sketch, type SketchPoint } from 'ribo-model'
import { layoutDimension, layoutGlyphs } from './annotations'
import { SketchEditor, type Snap } from './SketchEditor'
import { CircularPatternTool, MirrorTool, OffsetTool, RectangularPatternTool } from './transforms'
import { ProjectTool } from './project'
import {
  ArcTool,
  CircleTool,
  ConstraintTool,
  DimensionTool,
  FilletTool,
  LineTool,
  PointTool,
  PolygonTool,
  RectangleTool,
  SelectTool,
  SlotTool,
  Tool,
  TrimTool,
  type Hit,
  type ToolContext,
} from './tools'

/** Pick tolerances in screen pixels */
const POINT_TOLERANCE = 8
const CURVE_TOLERANCE = 6

export interface ConstraintToolInfo {
  id: string
  kind: ConstraintKind | 'HV'
  label: string
  instructions: string
  icon: string
  shortcut?: string
}

export const CONSTRAINT_TOOLS: ConstraintToolInfo[] = [
  { id: 'hv', kind: 'HV', label: 'Horizontal/Vertikal', instructions: 'Linie oder zwei Punkte wählen', icon: 'svg:hv', shortcut: 'H' },
  { id: 'coincident', kind: ConstraintKind.Coincident, label: 'Koinzident', instructions: 'Punkt, dann Punkt oder Kurve wählen', icon: 'svg:coincident' },
  { id: 'parallel', kind: ConstraintKind.Parallel, label: 'Parallel', instructions: 'Zwei Linien wählen', icon: 'svg:parallel' },
  { id: 'perpendicular', kind: ConstraintKind.Perpendicular, label: 'Senkrecht', instructions: 'Zwei Linien wählen', icon: 'svg:perpendicular' },
  { id: 'tangent', kind: ConstraintKind.Tangent, label: 'Tangential', instructions: 'Kreis/Bogen und eine Kurve wählen', icon: 'svg:tangent' },
  { id: 'equal', kind: ConstraintKind.Equal, label: 'Gleich', instructions: 'Zwei Linien oder zwei Kreise/Bögen wählen', icon: 'svg:equal' },
  { id: 'midpoint', kind: ConstraintKind.Midpoint, label: 'Mittelpunkt', instructions: 'Punkt und Linie wählen', icon: 'svg:midpoint' },
  { id: 'concentric', kind: ConstraintKind.Concentric, label: 'Konzentrisch', instructions: 'Zwei Kreise/Bögen wählen', icon: 'svg:concentric' },
  { id: 'collinear', kind: ConstraintKind.Collinear, label: 'Kollinear', instructions: 'Zwei Linien wählen', icon: 'svg:collinear' },
  { id: 'symmetric', kind: ConstraintKind.Symmetric, label: 'Symmetrisch', instructions: 'Zwei Punkte, dann die Symmetrielinie wählen', icon: 'svg:symmetric' },
  { id: 'fix', kind: ConstraintKind.Fix, label: 'Fixieren/Lösen', instructions: 'Punkt oder Kurve wählen', icon: 'svg:fix' },
]

/**
 * State of sketch mode: which sketch is open, the current tool, the
 * selection inside the sketch, and the inline editor of a dimension.
 */
export class SketcherController implements SketcherService {
  readonly active = shallowRef<Sketch | undefined>()
  readonly tool = ref('select')
  readonly current = shallowRef<Tool | undefined>()
  readonly selection = shallowRef<Set<EObject>>(new Set())
  /** Dimension whose value is being edited inline */
  readonly editing = shallowRef<Dimension | undefined>()
  /** Bumped when the tool's preview may have changed */
  readonly tick = ref(0)
  /** Display options of the sketch palette */
  readonly options = ref({ grid: true, profiles: true, dimensions: true, constraints: true, snapToGrid: false })

  editor: SketchEditor | undefined
  private returnSelection: EObject | undefined

  constructor(
    private readonly document: DocumentService,
    private readonly viewport: ViewportService,
    private readonly notifier: Notifier,
  ) {}

  // -------------------------------------------------------------- service

  async createSketch(): Promise<void> {
    if (this.active.value) this.finish()
    const pick = await this.viewport.pickPlane()
    if (!pick) return
    let sketch: Sketch
    if (pick.kind === 'origin') {
      sketch = this.document.addSketch(pick.plane, String(pick.offset))
    } else if (pick.kind === 'construction') {
      sketch = this.document.addSketch(this.document.design.value.features.get(pick.index) as ConstructionPlane)
    } else {
      // A slanted face gets a construction plane of its own to sketch on
      sketch = this.document.addSketch(this.document.addConstructionPlane(pick))
    }
    this.edit(sketch)
  }

  edit(sketch: Sketch): void {
    if (this.active.value === sketch) return
    if (this.active.value) this.finish()
    this.returnSelection = sketch
    this.editor = new SketchEditor(sketch, this.document, this.notifier)
    this.active.value = sketch
    this.selection.value = new Set()
    this.document.select(sketch)
    const frame = this.worldFrame(sketch)
    if (frame) this.viewport.enterSketchView(frame)
    this.setTool('select')
  }

  finish(): void {
    if (!this.active.value) return
    this.current.value?.escape()
    this.active.value = undefined
    this.editor = undefined
    this.current.value = undefined
    this.selection.value = new Set()
    this.editing.value = undefined
    this.viewport.exitSketchView()
    if (this.returnSelection) this.document.select(this.returnSelection)
  }

  // ----------------------------------------------------------------- tools

  setTool(id: string): void {
    if (!this.editor) return
    this.current.value?.escape()
    const ctx = this.context()
    const info = CONSTRAINT_TOOLS.find((t) => t.id === id)
    let tool: Tool
    if (info) {
      const constraintTool = new ConstraintTool(ctx, info.id, info.kind, info.label, info.instructions)
      // A matching selection is constrained at once, as in Fusion
      const picks = [...this.selection.value].filter((o) => isSketchPoint(o) || isSketchCurve(o)) as (SketchPoint | never)[]
      if (picks.length && constraintTool.applyTo(picks)) {
        this.selection.value = new Set()
        this.tool.value = 'select'
        this.current.value = new SelectTool(ctx)
        return
      }
      tool = constraintTool
    } else {
      tool = this.createTool(id, ctx)
    }
    this.tool.value = tool.id
    this.current.value = tool
    this.tick.value++
  }

  private createTool(id: string, ctx: ToolContext): Tool {
    switch (id) {
      case 'line':
        return new LineTool(ctx)
      case 'rectangle':
      case 'centerRectangle':
        return new RectangleTool(ctx, id)
      case 'circle':
        return new CircleTool(ctx)
      case 'arc':
        return new ArcTool(ctx)
      case 'polygon':
        return new PolygonTool(ctx)
      case 'slot':
        return new SlotTool(ctx)
      case 'point':
        return new PointTool(ctx)
      case 'fillet':
        return new FilletTool(ctx)
      case 'trim':
        return new TrimTool(ctx)
      case 'dimension':
        return new DimensionTool(ctx)
      case 'offset':
        return new OffsetTool(ctx)
      case 'mirror':
        return new MirrorTool(ctx)
      case 'rectPattern':
        return new RectangularPatternTool(ctx)
      case 'circPattern':
        return new CircularPatternTool(ctx)
      case 'project':
        return new ProjectTool(ctx)
      default:
        return new SelectTool(ctx)
    }
  }

  /** Escape: the tool cancels its step, then the tool ends, then the selection clears */
  escape(): void {
    if (this.editing.value) {
      this.editing.value = undefined
      return
    }
    const tool = this.current.value
    if (tool?.escape()) {
      this.tick.value++
      return
    }
    if (tool && tool.id !== 'select') {
      this.setTool('select')
      return
    }
    this.selection.value = new Set()
  }

  /** Deletes the selected sketch objects */
  deleteSelection(): void {
    const objects = [...this.selection.value]
    if (!objects.length) return
    this.document.history.record('Löschen', () => {
      for (const object of objects) {
        if (object.eContainer() && sketchOf(object)) this.document.remove(object)
      }
    })
    this.selection.value = new Set()
  }

  /** Toggles construction on the selected curves */
  toggleConstruction(): void {
    const curves = [...this.selection.value].filter(isSketchCurve)
    if (!curves.length) {
      this.notifier.info('Erst Kurven wählen, dann Hilfsgeometrie umschalten')
      return
    }
    const target = !curves.every((c) => c.construction)
    this.document.history.record('Hilfsgeometrie', () => curves.forEach((c) => (c.construction = target)))
  }

  /** Writes an edited dimension value; reverts it when the sketch cannot be solved with it */
  commitDimension(dimension: Dimension, expression: string): void {
    this.editing.value = undefined
    const previous = dimension.expression
    if (expression.trim() === '' || expression === previous) return
    try {
      this.document.evaluate(expression)
    } catch (error) {
      this.notifier.error((error as Error).message)
      return
    }
    this.document.history.record('Bemaßung ändern', () => {
      dimension.expression = expression
      const outcome = this.document.solveSketch(this.editor!.sketch)
      if (outcome && !outcome.ok) {
        dimension.expression = previous
        this.document.solveSketch(this.editor!.sketch)
        this.notifier.error('Mit diesem Wert lässt sich die Skizze nicht lösen')
      }
    })
  }

  // ------------------------------------------------------------- context

  view(): SketchView | undefined {
    return this.viewport.sketchView.value
  }

  toSketch(screen: Vec2): Vec2 {
    const view = this.view()!
    return screenToSketch(view, screen)
  }

  snap(at: Vec2, skip?: Set<SketchPoint>): Snap {
    const view = this.view()
    if (!this.editor || !view) return { kind: 'free', at }
    const snap = this.editor.snap(at, POINT_TOLERANCE / view.scale, skip)
    if (snap.kind === 'free' && this.options.value.snapToGrid) {
      const step = gridStep(view.scale)
      return { kind: 'free', at: [Math.round(at[0] / step) * step, Math.round(at[1] / step) * step] }
    }
    return snap
  }

  /** What is under a screen position: points first, then glyphs, dimension labels, curves */
  hit(screen: Vec2): Hit | undefined {
    const view = this.view()
    const editor = this.editor
    if (!view || !editor) return undefined
    const at = screenToSketch(view, screen)
    const point = editor.pointAt(at, POINT_TOLERANCE / view.scale)
    if (point) return { kind: 'point', point }
    if (this.options.value.constraints) {
      const glyph = layoutGlyphs(view, editor.sketch).find((g) => Math.hypot(g.at[0] - screen[0], g.at[1] - screen[1]) < 9)
      if (glyph) return { kind: 'glyph', constraint: glyph.constraint }
    }
    if (this.options.value.dimensions) {
      for (const constraint of editor.sketch.constraints.toArray()) {
        if (!editor.isDimension(constraint)) continue
        const layout = layoutDimension(view, constraint, undefined)
        if (!layout) continue
        const width = layout.text.length * 4 + 10
        if (Math.abs(layout.label[0] - screen[0]) < width && Math.abs(layout.label[1] - screen[1]) < 11) return { kind: 'dimension', dimension: constraint }
      }
    }
    const curve = editor.curveAt(at, CURVE_TOLERANCE / view.scale)
    if (curve) return { kind: 'curve', curve: curve.curve, at: curve.at }
    return undefined
  }

  private context(): ToolContext {
    return {
      editor: this.editor!,
      document: this.document,
      notifier: this.notifier,
      view: () => this.view()!,
      px: (pixels) => pixels / (this.view()?.scale ?? 1),
      snap: (at, skip) => this.snap(at, skip),
      hit: (screen) => this.hit(screen),
      selection: {
        get: () => this.selection.value,
        set: (objects) => {
          this.selection.value = objects
        },
      },
      setTool: (id) => this.setTool(id),
      editDimension: (dimension) => {
        this.editing.value = dimension
      },
      bodyEdges: () => this.bodyEdges(),
    }
  }

  private edgeCache: { result: unknown; sketch: Sketch; placements: unknown; edges: Vec2[][] } | undefined

  /** The sketch's plane where its component sits in the assembly */
  private worldFrame(sketch: Sketch): Frame | undefined {
    const frame = this.document.sketchPlan(sketch)?.frame
    if (!frame) return undefined
    const m = this.document.placements.value[this.document.componentIndexOf(sketch)] ?? IDENTITY
    return { origin: applyPoint(m, frame.origin), x: applyDirection(m, frame.x), y: applyDirection(m, frame.y), normal: applyDirection(m, frame.normal) }
  }

  /** Body edges in sketch coordinates; projecting onto the plane just drops the normal part */
  private bodyEdges(): Vec2[][] {
    const result = this.document.result.value
    const sketch = this.active.value
    if (!result || !sketch) return []
    if (this.edgeCache?.result === result && this.edgeCache.sketch === sketch && this.edgeCache.placements === this.document.placements.value) return this.edgeCache.edges
    const frame = this.worldFrame(sketch)
    if (!frame) return []
    const placements = this.document.placements.value
    const edges = result.bodies.flatMap((body) =>
      body.edgeGroups.map(({ start, count }) => {
        const points: Vec2[] = []
        const placement = placements[body.component] ?? IDENTITY
        for (let i = start; i + 2 < start + count; i += 3) {
          const p = worldToFrame(frame, applyPoint(placement, [body.edges[i]!, body.edges[i + 1]!, body.edges[i + 2]!]))
          const previous = points[points.length - 1]
          if (!previous || Math.hypot(p[0] - previous[0], p[1] - previous[1]) > 1e-9) points.push(p)
        }
        return points
      }),
    )
    this.edgeCache = { result, sketch, placements, edges }
    return edges
  }
}

/** Grid spacing in mm for a zoom level: 1, 2 or 5 times a power of ten, at least ~12 px */
export function gridStep(scale: number): number {
  const minimum = 12 / scale
  const power = Math.pow(10, Math.floor(Math.log10(minimum)))
  for (const factor of [1, 2, 5, 10]) {
    if (power * factor >= minimum) return power * factor
  }
  return power * 10
}
