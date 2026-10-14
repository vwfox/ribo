/**
 * Service contracts shared by the ribo modules.
 *
 * Names and types only. A module that needs another module's service imports
 * the id from here and gets the instance from `context.services` - never from
 * the other module's internals.
 */

import { serviceId } from '@eclipse-daanse/tsm'
import type { App, Component, ComputedRef, Ref, ShallowRef } from 'vue'
import type { EObject } from '@emfts/core'
import type {
  Design,
  EdgeFeature,
  Feature,
  Shell,
  Parameter,
  ProfileFeature,
  Sketch,
  SketchConstraint,
  SketchCurve,
  SketchPlane,
  SketchPoint,
} from 'ribo-model'

export * from './geometry'
import type { BuildPlan, BuildResult, ExportFormat, FeatureProblem, PlanFeature, PlanPlane, Vec2, Vec3 } from './geometry'

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface KernelService {
  /** Resolves once OpenCascade is loaded */
  readonly ready: Promise<void>
  build(plan: BuildPlan): Promise<BuildResult>
  export(plan: BuildPlan, format: ExportFormat): Promise<Blob>
}

export const KERNEL = serviceId<KernelService>('ribo.kernel')

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface SolveOutcome {
  ok: boolean
  /** Constraints the solver found in conflict */
  conflicting: SketchConstraint[]
  /** Dimensions whose expression could not be evaluated */
  invalid: SketchConstraint[]
  /** Remaining degrees of freedom */
  dof: number
}

export interface HistoryService {
  readonly canUndo: ComputedRef<boolean>
  readonly canRedo: ComputedRef<boolean>
  readonly undoLabel: ComputedRef<string | undefined>
  readonly redoLabel: ComputedRef<string | undefined>
  undo(): void
  redo(): void
  /** Opens a step spanning a gesture, e.g. a drag */
  begin(label: string): void
  end(): void
  /** Runs a change as one named step */
  record<T>(label: string, change: () => T): T
}

export type SketchPlanFeature = Extract<PlanFeature, { kind: 'sketch' }>

export interface DocumentService {
  /** The design being edited; re-triggered whenever anything in it changes */
  readonly design: ShallowRef<Design>
  /** Counts model changes; read it to re-run on any change */
  readonly revision: Readonly<Ref<number>>
  readonly selection: ShallowRef<EObject | undefined>
  /** Evaluated plan of the current revision */
  readonly plan: ShallowRef<BuildPlan>
  /** Problems found while evaluating (expressions, missing references, solving) and building */
  readonly problems: ShallowRef<FeatureProblem[]>
  readonly result: ShallowRef<BuildResult | undefined>
  readonly building: Readonly<Ref<boolean>>
  readonly history: HistoryService
  /** True once the sketch solver is loaded */
  readonly solverReady: Readonly<Ref<boolean>>

  select(object: EObject | undefined): void

  newDesign(): void
  /** Replaces the design with one read from emfts JSON */
  load(json: string): void
  /** The design as emfts JSON */
  save(): string

  /** Value of an expression in the scope of the design's parameters (mm or degrees) */
  evaluate(expression: string): number
  /** Parameter values, in declaration order; a broken parameter maps to an Error */
  parameterValues(): Map<Parameter, number | Error>

  addParameter(): Parameter
  /** A new sketch (with its origin point) at the end of the timeline, or at the rollback marker */
  addSketch(plane: SketchPlane, offset?: string): Sketch
  addExtrude(sketch?: Sketch): ProfileFeature
  addRevolve(sketch?: Sketch): ProfileFeature
  /** Removes an object and everything that only existed for it (constraints, orphaned points, references) */
  remove(object: EObject): void
  /** The sketches before the given feature in the timeline */
  sketchesBefore(feature: Feature): Sketch[]

  /** Solves a sketch now and writes the result; undefined while the solver loads */
  solveSketch(sketch: Sketch): SolveOutcome | undefined
  /** Pulls a point towards (x, y) as far as the constraints allow */
  dragPoint(point: SketchPoint, x: number, y: number): void
  /** Points and curves of the sketch not yet fully defined (drawn blue) */
  underdefined(sketch: Sketch): { points: Set<SketchPoint>; curves: Set<SketchCurve> }
  /** Curves and regions of a sketch as currently evaluated */
  sketchPlan(sketch: Sketch): SketchPlanFeature | undefined

  /** Adds the region at a sketch point to the feature's profiles, or removes it when already picked */
  toggleProfile(feature: ProfileFeature, point: Vec2): void
  /** Moves the timeline marker: only features before index are built; -1 builds all */
  setRollback(index: number): void

  addFillet(): EdgeFeature
  addChamfer(): EdgeFeature
  addShell(): Shell
  /** Adds the edge with this midpoint, or with `existing` removes that earlier pick */
  toggleEdge(feature: EdgeFeature, midpoint: Vec3, existing?: number): void
  /** Adds the face at this point, or with `existing` removes that earlier pick */
  toggleFace(feature: Shell, point: Vec3, existing?: number): void
  /**
   * The bodies as they are before the selected edge or face feature - what
   * its edges and faces are picked on. Undefined when no such feature is selected.
   */
  readonly inputResult: ShallowRef<BuildResult | undefined>
}

export const DOCUMENT = serviceId<DocumentService>('ribo.document')

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/** A plane picked for a new sketch */
export interface PlanePick {
  plane: PlanPlane
  /** Offset along the plane normal, mm */
  offset: number
}

/** The 2D view of a sketch plane, as the viewport shows it in sketch mode */
export interface SketchView {
  plane: PlanPlane
  offset: number
  /** Sketch coordinates shown in the middle of the viewport */
  center: Vec2
  /** Screen pixels per millimetre */
  scale: number
  /** Viewport size in CSS pixels */
  width: number
  height: number
}

export interface ViewportService {
  readonly mode: Readonly<Ref<'model' | 'sketch'>>
  /** The 2D view while in sketch mode */
  readonly sketchView: ShallowRef<SketchView | undefined>
  /** Turns the camera onto the sketch plane and switches to the flat 2D view */
  enterSketchView(plane: PlanPlane, offset: number): void
  /** Back to the 3D view the user had before */
  exitSketchView(): void
  /** Lets the user click an origin plane or a flat face; undefined on Escape */
  pickPlane(): Promise<PlanePick | undefined>
  /** A component drawn over the viewport, e.g. the sketch editor */
  registerOverlay(component: Component): () => void
}

export const VIEWPORT = serviceId<ViewportService>('ribo.viewport')

/** Screen <-> sketch coordinates of a sketch view */
export function sketchToScreen(view: SketchView, [u, v]: Vec2): Vec2 {
  return [view.width / 2 + (u - view.center[0]) * view.scale, view.height / 2 - (v - view.center[1]) * view.scale]
}

export function screenToSketch(view: SketchView, [x, y]: Vec2): Vec2 {
  return [view.center[0] + (x - view.width / 2) / view.scale, view.center[1] - (y - view.height / 2) / view.scale]
}

// ---------------------------------------------------------------------------
// Sketcher
// ---------------------------------------------------------------------------

export interface SketcherService {
  /** The sketch being edited, if any */
  readonly active: ShallowRef<Sketch | undefined>
  /** Id of the current tool, 'select' when none */
  readonly tool: Ref<string>
  /** Picks a plane, creates a sketch on it and opens it */
  createSketch(): Promise<void>
  /** Opens a sketch for editing */
  edit(sketch: Sketch): void
  /** Leaves sketch mode */
  finish(): void
}

export const SKETCHER = serviceId<SketcherService>('ribo.sketcher')

// ---------------------------------------------------------------------------
// Workbench: panels and actions
// ---------------------------------------------------------------------------

export type PanelLocation = 'left' | 'center' | 'right'

export interface PanelContribution {
  id: string
  title: string
  /** PrimeIcons class, e.g. 'pi pi-box' */
  icon?: string
  location: PanelLocation
  component: Component
  /** Lower comes first */
  order?: number
  /** Hidden panels are not shown, e.g. the sketch palette outside sketch mode */
  visible?: () => boolean
}

export interface PanelRegistry {
  readonly panels: readonly PanelContribution[]
  /** Returns the function that removes the panel again */
  register(panel: PanelContribution): () => void
}

export const PANELS = serviceId<PanelRegistry>('ribo.registry.panels')

export interface ActionContribution {
  id: string
  label: string
  /** PrimeIcons class, or an inline SVG path when it starts with 'svg:' */
  icon?: string
  /** Toolbar group, e.g. 'file', 'create' */
  group: string
  order?: number
  /** Shortcut as shown, e.g. 'Ctrl+S'; handled by the shell */
  shortcut?: string
  enabled?: () => boolean
  /** Hidden actions neither show nor react to their shortcut */
  visible?: () => boolean
  /** Shown pressed, e.g. the current sketch tool */
  active?: () => boolean
  run: () => void | Promise<void>
}

export interface ActionRegistry {
  readonly actions: readonly ActionContribution[]
  register(action: ActionContribution): () => void
  run(id: string): Promise<void>
}

export const ACTIONS = serviceId<ActionRegistry>('ribo.registry.actions')

export interface Notifier {
  info(message: string): void
  error(message: string): void
}

export const NOTIFIER = serviceId<Notifier>('ribo.notifier')

export const APP = serviceId<App>('app.instance')
