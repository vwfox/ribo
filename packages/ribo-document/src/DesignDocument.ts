import { ref, shallowRef, triggerRef } from 'vue'
import {
  EContentAdapter,
  JSONResource,
  NotificationType,
  OPTION_INDENT,
  URI,
  type EObject,
  type Notification,
} from '@emfts/core'
import {
  RiboFactory,
  FeatureOperation,
  isFeature,
  isParameter,
  isProfileFeature,
  isRevolve,
  isSketch,
  isSketchConstraint,
  isSketchCurve,
  isSketchPoint,
  pointsOf,
  sketchOf,
  type Design,
  type Feature,
  type Parameter,
  type ProfileFeature,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
  type SketchPlane,
  type SketchPoint,
} from 'ribo-model'
import type {
  BuildPlan,
  BuildResult,
  DocumentService,
  FeatureProblem,
  KernelService,
  SketchPlanFeature,
  SolveOutcome,
  Vec2,
} from 'ribo-contracts'
import { evaluateExpression } from './expression'
import { History } from './History'
import { compilePlan, evaluateParameters, scopeOf, sketchCurves, sketchRegions } from './plan'
import { regionAt } from 'ribo-geometry'
import type { SketchSolver } from './solver'

const BUILD_DELAY_MS = 120

/** Problems of the whole build, not of one feature */
export const DESIGN_PROBLEM_INDEX = -1

/** Reports every real change anywhere below the object it is attached to. */
class ChangeAdapter extends EContentAdapter {
  constructor(private readonly onChange: () => void) {
    super()
  }

  override notifyChanged(notification: Notification): void {
    super.notifyChanged(notification)
    if (notification.isTouch()) return
    if (notification.getEventType() === NotificationType.REMOVING_ADAPTER) return
    this.onChange()
  }
}

/**
 * The design being edited, and everything derived from it.
 *
 * The design is an EMF model. An EContentAdapter on its root reports every
 * change; the changes of one task are handled together in a microtask: the
 * sketches are solved, the plan evaluated, and a kernel build scheduled
 * (debounced, it is the expensive part). EObjects are only ever held in
 * shallow refs - never in reactive(), see board's useEmf.ts for why.
 */
export class DesignDocument implements DocumentService {
  readonly design = shallowRef<Design>(undefined as unknown as Design)
  readonly revision = ref(0)
  readonly selection = shallowRef<EObject | undefined>()
  readonly plan = shallowRef<BuildPlan>({ features: [] })
  readonly problems = shallowRef<FeatureProblem[]>([])
  readonly result = shallowRef<BuildResult | undefined>()
  readonly building = ref(false)
  readonly history = new History()
  readonly solverReady = ref(false)

  private readonly factory = RiboFactory.eINSTANCE
  private readonly adapter: EContentAdapter
  private solver: SketchSolver | undefined
  /** While set, notifications are not counted as changes (saving touches the root) */
  private muted = false
  private updateQueued = false
  private compileProblems: FeatureProblem[] = []
  private solveProblems: FeatureProblem[] = []
  private buildTimer: ReturnType<typeof setTimeout> | undefined
  private buildRunning = false
  private buildAgain = false

  constructor(
    private readonly kernel: KernelService,
    solver: Promise<SketchSolver>,
  ) {
    this.adapter = new ChangeAdapter(() => {
      if (!this.muted) this.changed()
    })
    this.setDesign(this.createDesign())
    solver.then(
      (ready) => {
        this.solver = ready
        this.solverReady.value = true
        this.changed()
      },
      (error) => console.error('Sketch solver failed to load', error),
    )
  }

  dispose(): void {
    clearTimeout(this.buildTimer)
    this.history.detach()
    ;(this.design.value as unknown as { eAdapterRemove(a: EContentAdapter): boolean })?.eAdapterRemove(this.adapter)
    this.solver?.dispose()
  }

  // ------------------------------------------------------------- lifecycle

  select(object: EObject | undefined): void {
    this.selection.value = object
  }

  newDesign(): void {
    this.setDesign(this.createDesign())
  }

  load(json: string): void {
    const resource = new JSONResource(URI.createURI('design.ribo.json'))
    resource.loadFromString(json)
    const root = resource.getContents().get(0)
    if (!root || root.eClass().getName() !== 'Design') throw new Error('Die Datei enthält kein ribo-Design')
    resource.getContents().clear()
    this.setDesign(root as Design)
  }

  save(): string {
    const design = this.design.value
    const resource = new JSONResource(URI.createURI('design.ribo.json'))
    this.muted = true
    try {
      return this.history.unrecorded(() => {
        resource.getContents().add(design)
        try {
          return resource.saveToString(new Map([[OPTION_INDENT, 2]]))
        } finally {
          // Detach again so the live root is not owned by a throwaway resource
          resource.getContents().clear()
        }
      })
    } finally {
      this.muted = false
    }
  }

  // ----------------------------------------------------------- expressions

  evaluate(expression: string): number {
    return evaluateExpression(expression, scopeOf(evaluateParameters(this.design.value)))
  }

  parameterValues(): Map<Parameter, number | Error> {
    return evaluateParameters(this.design.value)
  }

  // --------------------------------------------------------------- editing

  addParameter(): Parameter {
    const design = this.design.value
    const parameter = this.factory.createParameter()
    parameter.name = this.uniqueName(
      'p',
      design.parameters.toArray().map((p) => p.name),
    )
    parameter.expression = '10 mm'
    this.history.record('Parameter hinzufügen', () => design.parameters.add(parameter))
    this.select(parameter)
    return parameter
  }

  addSketch(plane: SketchPlane, offset = '0'): Sketch {
    const sketch = this.factory.createSketch()
    sketch.name = this.nextFeatureName('Skizze')
    sketch.plane = plane
    sketch.offset = offset
    const origin = this.factory.createSketchPoint()
    origin.origin = true
    sketch.points.add(origin)
    this.history.record('Skizze erstellen', () => this.insertFeature(sketch))
    this.select(sketch)
    return sketch
  }

  addExtrude(sketch?: Sketch): ProfileFeature {
    const extrude = this.factory.createExtrude()
    extrude.name = this.nextFeatureName('Extrusion')
    return this.addProfileFeature(extrude, 'Extrudieren', sketch)
  }

  addRevolve(sketch?: Sketch): ProfileFeature {
    const revolve = this.factory.createRevolve()
    revolve.name = this.nextFeatureName('Drehung')
    return this.addProfileFeature(revolve, 'Drehen', sketch)
  }

  remove(object: EObject): void {
    const selected = this.selection.value
    this.history.record('Löschen', () => this.removeNow(object))
    if (selected === object || this.isInside(selected, object)) this.select(undefined)
  }

  sketchesBefore(feature: Feature): Sketch[] {
    const features = this.design.value.features.toArray()
    const end = features.indexOf(feature)
    return features.slice(0, end < 0 ? features.length : end).filter(isSketch)
  }

  // ---------------------------------------------------------------- sketch

  solveSketch(sketch: Sketch): SolveOutcome | undefined {
    if (!this.solver) return undefined
    return this.solver.solve(sketch, (expression) => this.evaluate(expression))
  }

  dragPoint(point: SketchPoint, x: number, y: number): void {
    const sketch = sketchOf(point)
    if (!this.solver || !sketch || point.origin) return
    this.solver.solve(sketch, (expression) => this.evaluate(expression), { point, x, y })
  }

  underdefined(sketch: Sketch): { points: Set<SketchPoint>; curves: Set<SketchCurve> } {
    if (!this.solver) return { points: new Set(sketch.points.toArray().filter((p) => !p.origin)), curves: new Set(sketch.curves.toArray()) }
    return this.solver.underdefined(sketch, (expression) => this.evaluate(expression))
  }

  sketchPlan(sketch: Sketch): SketchPlanFeature | undefined {
    const index = this.design.value.features.indexOf(sketch)
    const planned = this.plan.value.features.find((f): f is SketchPlanFeature => f.kind === 'sketch' && f.index === index)
    if (planned) return planned
    // Rolled back or suppressed: evaluate it on its own
    if (index < 0) return undefined
    let offset = 0
    try {
      offset = this.evaluate(sketch.offset ?? '0')
    } catch {
      offset = 0
    }
    const curves = sketchCurves(sketch)
    return { kind: 'sketch', index, plane: sketch.plane ?? 'XY', offset, curves, regions: sketchRegions(curves) }
  }

  toggleProfile(feature: ProfileFeature, point: Vec2): void {
    const sketch = feature.sketch
    const planned = sketch && this.sketchPlan(sketch)
    if (!planned) return
    const regions = planned.regions
    const target = regionAt(regions, point)
    if (target < 0) return
    const picks = feature.profiles.toArray()
    const existing = picks.find((pick) => regionAt(regions, [pick.u, pick.v]) === target)
    this.history.record('Profil wählen', () => {
      if (existing) {
        feature.profiles.remove(existing)
        return
      }
      if (picks.length === 0) {
        // Leaving the automatic choice: start from what it had chosen, then toggle the target
        regions.forEach((region, i) => {
          if (region.depth % 2 === 0 && i !== target) feature.profiles.add(this.profilePick(region.inside))
        })
        if (regions[target]!.depth % 2 === 0) return
      }
      feature.profiles.add(this.profilePick(regions[target]!.inside))
    })
  }

  setRollback(index: number): void {
    const design = this.design.value
    const value = index < 0 || index >= design.features.size() ? -1 : index
    if (design.rollback === value) return
    this.history.record('Zeitleiste verschieben', () => {
      design.rollback = value
    })
  }

  // ------------------------------------------------------------- internals

  private profilePick([u, v]: Vec2) {
    const pick = this.factory.createProfileSelection()
    pick.u = u
    pick.v = v
    return pick
  }

  private createDesign(): Design {
    const design = this.factory.createDesign()
    design.name = 'Unbenannt'
    return design
  }

  private setDesign(design: Design): void {
    const adaptable = (object: Design | undefined) =>
      object as unknown as { eAdapterAdd(a: EContentAdapter): void; eAdapterRemove(a: EContentAdapter): boolean } | undefined
    adaptable(this.design.value)?.eAdapterRemove(this.adapter)
    this.design.value = design
    adaptable(design)?.eAdapterAdd(this.adapter)
    this.history.attach(design)
    this.selection.value = undefined
    this.result.value = undefined
    this.changed()
  }

  /** New features go to the rollback marker when one is set, and the marker moves past them */
  private insertFeature(feature: Feature): void {
    const design = this.design.value
    const rollback = design.rollback ?? -1
    if (rollback >= 0) {
      design.features.addAt(rollback, feature)
      design.rollback = rollback + 1
    } else {
      design.features.add(feature)
    }
  }

  private addProfileFeature(feature: ProfileFeature, label: string, sketch?: Sketch): ProfileFeature {
    const design = this.design.value
    const selectedSketch = sketchOf(this.selection.value)
    feature.sketch = (sketch ?? selectedSketch ?? design.features.toArray().filter(isSketch).at(-1)) as Sketch
    const hasBody = design.features.toArray().some((f) => isProfileFeature(f) && !f.suppressed)
    feature.operation = hasBody ? FeatureOperation.Join : FeatureOperation.NewBody
    this.history.record(label, () => this.insertFeature(feature))
    this.select(feature)
    return feature
  }

  private removeNow(object: EObject): void {
    const design = this.design.value

    if (isFeature(object)) {
      if (isSketch(object)) {
        for (const feature of design.features.toArray().filter(isProfileFeature)) {
          if (feature.sketch !== object) continue
          feature.sketch = undefined as unknown as Sketch
          feature.profiles.clear()
          if (isRevolve(feature)) feature.axisLine = undefined as never
        }
      }
      const index = design.features.indexOf(object)
      design.features.remove(object)
      const rollback = design.rollback ?? -1
      if (rollback > index) design.rollback = rollback - 1
      if ((design.rollback ?? -1) >= design.features.size()) design.rollback = -1
      return
    }
    if (isParameter(object)) {
      design.parameters.remove(object)
      return
    }

    const sketch = sketchOf(object)
    if (!sketch) return
    if (isSketchConstraint(object)) {
      sketch.constraints.remove(object)
    } else if (isSketchCurve(object)) {
      this.removeCurve(sketch, object)
    } else if (isSketchPoint(object)) {
      if (object.origin) return
      for (const curve of sketch.curves.toArray()) {
        if (pointsOf(curve).includes(object)) this.removeCurve(sketch, curve)
      }
      this.removeConstraintsOn(sketch, (c) => c.points.contains(object))
      if (sketch.points.contains(object)) sketch.points.remove(object)
    }
  }

  private removeCurve(sketch: Sketch, curve: SketchCurve): void {
    const points = pointsOf(curve)
    this.removeConstraintsOn(sketch, (c) => c.curves.contains(curve))
    for (const feature of this.design.value.features.toArray()) {
      if (isRevolve(feature) && feature.axisLine === curve) feature.axisLine = undefined as never
    }
    sketch.curves.remove(curve)
    // Points nothing else uses go with the curve
    const used = new Set(sketch.curves.toArray().flatMap(pointsOf))
    for (const point of points) {
      if (point.origin || used.has(point)) continue
      this.removeConstraintsOn(sketch, (c) => c.points.contains(point))
      sketch.points.remove(point)
    }
  }

  private removeConstraintsOn(sketch: Sketch, test: (constraint: SketchConstraint) => boolean): void {
    for (const constraint of sketch.constraints.toArray()) if (test(constraint)) sketch.constraints.remove(constraint)
  }

  private nextFeatureName(prefix: string): string {
    return this.uniqueName(
      `${prefix} `,
      this.design.value.features.toArray().map((f) => f.name),
    )
  }

  private uniqueName(prefix: string, taken: (string | undefined)[]): string {
    const names = new Set(taken)
    for (let i = 1; ; i++) {
      const name = `${prefix}${i}`
      if (!names.has(name)) return name
    }
  }

  private isInside(object: EObject | undefined, container: EObject): boolean {
    for (let current = object?.eContainer(); current; current = current.eContainer()) {
      if (current === container) return true
    }
    return false
  }

  /** Collects the changes of one task; the work happens once, in a microtask */
  private changed(): void {
    this.revision.value++
    if (this.updateQueued) return
    this.updateQueued = true
    queueMicrotask(() => {
      this.updateQueued = false
      this.update()
    })
  }

  private update(): void {
    const design = this.design.value

    // Re-solve every sketch: parameters drive dimensions. Solving is derived
    // state, so it neither counts as a change of its own nor as an undo step.
    this.solveProblems = []
    if (this.solver) {
      this.muted = true
      try {
        this.history.unrecorded(() => {
          design.features.toArray().forEach((feature, index) => {
            if (!isSketch(feature) || feature.constraints.size() === 0) return
            const outcome = this.solver!.solve(feature, (expression) => this.evaluate(expression))
            if (!outcome.ok) this.solveProblems.push({ index, message: 'Skizze ist überbestimmt oder widersprüchlich' })
            else if (outcome.invalid.length) this.solveProblems.push({ index, message: 'Eine Bemaßung hat einen ungültigen Wert' })
          })
        })
      } finally {
        this.muted = false
      }
    }

    const compiled = compilePlan(design)
    this.plan.value = compiled.plan
    this.compileProblems = compiled.problems
    this.problems.value = this.mergeProblems(this.result.value?.problems ?? [])
    // The solver's writes were muted; views keyed on the revision must still see them
    this.revision.value++
    triggerRef(this.design)

    clearTimeout(this.buildTimer)
    this.buildTimer = setTimeout(() => void this.build(), BUILD_DELAY_MS)
  }

  private async build(): Promise<void> {
    if (this.buildRunning) {
      this.buildAgain = true
      return
    }
    this.buildRunning = true
    this.building.value = true
    try {
      do {
        this.buildAgain = false
        const plan = this.plan.value
        try {
          const result = await this.kernel.build(plan)
          if (this.plan.value !== plan) continue
          this.result.value = result
          this.problems.value = this.mergeProblems(result.problems)
        } catch (error) {
          this.problems.value = this.mergeProblems([{ index: DESIGN_PROBLEM_INDEX, message: `Kernel: ${(error as Error).message}` }])
        }
      } while (this.buildAgain)
    } finally {
      this.buildRunning = false
      this.building.value = false
    }
  }

  private mergeProblems(buildProblems: FeatureProblem[]): FeatureProblem[] {
    return [...this.solveProblems, ...this.compileProblems, ...buildProblems].sort((a, b) => a.index - b.index)
  }
}
