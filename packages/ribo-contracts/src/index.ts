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
  Component as ModelComponent,
  ConstructionPlane,
  Design,
  EdgeFeature,
  Feature,
  Hole,
  Joint,
  Fastening,
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
import type { BuildPlan, BuildResult, ExportFormat, FeatureProblem, Frame, Matrix, PlannedFeature, PlanPlane, Vec2, Vec3 } from './geometry'

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface KernelService {
  /** Resolves once OpenCascade is loaded */
  readonly ready: Promise<void>
  build(plan: BuildPlan): Promise<BuildResult>
  /**
   * `title` names the part inside formats that carry names (3MF); with
   * `placements` (per component index) bodies are exported where the assembly puts them.
   */
  export(plan: BuildPlan, format: ExportFormat, title?: string, placements?: Matrix[]): Promise<Blob>
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

export type SketchPlanFeature = Extract<PlannedFeature, { kind: 'sketch' }>

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
  /** Replaces the design with one read from XMI or emfts JSON (told apart by content) */
  load(text: string): void
  /** The design as emfts JSON (default, used for the autosave) or XMI */
  save(format?: 'json' | 'xmi'): string

  /** Value of an expression in the scope of the design's parameters (mm or degrees) */
  evaluate(expression: string): number
  /** Parameter values, in declaration order; a broken parameter maps to an Error */
  parameterValues(): Map<Parameter, number | Error>

  addParameter(): Parameter
  /** A new sketch (with its origin point) on an origin or construction plane, at the end of the timeline or the rollback marker */
  addSketch(plane: SketchPlane | ConstructionPlane, offset?: string): Sketch
  /** A construction plane on a picked origin plane, face or other construction plane */
  addConstructionPlane(pick: PlanePick): ConstructionPlane
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
  /**
   * Moves a component's timeline marker (without one: the design's): its
   * features from index on are not built; -1 builds all
   */
  setRollback(index: number, component?: ModelComponent): void

  addFillet(): EdgeFeature
  addChamfer(): EdgeFeature
  addShell(): Shell
  /** A hole feature drilling at the points of the sketch (default: selected or last sketch) */
  addHole(sketch?: Sketch): Hole
  /** Adds the edge with this midpoint, or with `existing` removes that earlier pick */
  toggleEdge(feature: EdgeFeature, midpoint: Vec3, existing?: number): void
  /** Adds the face at this point, or with `existing` removes that earlier pick */
  toggleFace(feature: Shell, point: Vec3, existing?: number): void
  /**
   * The bodies as they are before the selected edge or face feature - what
   * its edges and faces are picked on. Undefined when no such feature is selected.
   */
  readonly inputResult: ShallowRef<BuildResult | undefined>

  /** Placement of each component, by component index (0: the design itself) */
  readonly placements: ShallowRef<Matrix[]>
  /** Degrees of freedom alignments leave a component, by component index; undefined where no alignment places it */
  readonly freedom: ShallowRef<(number | undefined)[]>
  /** Component index of the side a relation moves: its second reference, unless only the first can move */
  movedBy(relation: Joint | Fastening): number
  /** A screwed joint, holes to be picked in the viewport */
  addFastening(): Fastening
  /** Adds a picked hole edge: the nut side of the last screw still missing one, else the head side of a new screw */
  addFastenerHole(fastening: Fastening, component: number, origin: Vec3, z: Vec3, x: Vec3, radius: number): void
  /** A new component, made the active one */
  addComponent(): ModelComponent
  /** New features go into the active component; undefined is the design itself */
  activate(component: ModelComponent | undefined): void
  /** Component index of a component, or of the component a feature builds in */
  componentIndexOf(object: ModelComponent | Feature | undefined): number
  componentAt(index: number): ModelComponent | undefined
  addJoint(): Joint
  /** A one-off alignment: pick two origins, the component moves there, no joint stays */
  addAlignment(): Joint
  /** Sets one of a joint's origins: a point with z and x axes in the coordinates of that component */
  setJointOrigin(joint: Joint, which: 'first' | 'second', component: number, origin: Vec3, z: Vec3, x: Vec3, kind?: 'Face' | 'CircularEdge' | 'Edge'): void
  /** Bakes a joint's current placement into its moving component and removes the joint */
  applyAlignment(joint: Joint): void
  /** Swaps a joint's origins: the other component moves */
  swapJointOrigins(joint: Joint): void
}

export const DOCUMENT = serviceId<DocumentService>('ribo.document')

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

/** A plane picked for a new sketch: an origin plane (axis-aligned faces become these), a slanted face, or a construction plane */
export type PlanePick =
  | { kind: 'origin'; plane: PlanPlane; offset: number }
  | { kind: 'face'; origin: Vec3; normal: Vec3 }
  /** Timeline index of the construction plane */
  | { kind: 'construction'; index: number }

/** The 2D view of a sketch plane, as the viewport shows it in sketch mode */
export interface SketchView {
  frame: Frame
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
  enterSketchView(frame: Frame): void
  /** Back to the 3D view the user had before */
  exitSketchView(): void
  /** Lets the user click an origin plane or a flat face; undefined on Escape */
  pickPlane(): Promise<PlanePick | undefined>
  /** A component drawn over the viewport, e.g. the sketch editor */
  registerOverlay(component: Component): () => void
  /** Size of the printer's build volume, mm; drawn as bed grid and frame */
  setBed(size: Vec3): void
  /** Coloured triangles over the bodies, e.g. overhangs; replaces the layer with the same id, empty positions remove it */
  setAnalysisLayer(layer: AnalysisLayer): void
  /** The component the move gizmo sits on, if any */
  readonly moving: ShallowRef<ModelComponent | undefined>
  /** Shows the move gizmo on a component (drag to move or turn it), or ends moving with undefined */
  moveComponent(component: ModelComponent | undefined): void
}

export interface AnalysisLayer {
  id: string
  /** Triangle corners, xyz, three per triangle */
  positions: Float32Array
  color: string
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

/** Where a panel docks; 'center' is the viewport and does not move */
export type PanelLocation = 'left' | 'center' | 'right' | 'bottom'

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
