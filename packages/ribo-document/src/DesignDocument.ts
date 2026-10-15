import { ref, shallowRef, triggerRef } from 'vue'
import {
  EContentAdapter,
  JSONResource,
  NotificationType,
  OPTION_INDENT,
  URI,
  XMIResource,
  type EObject,
  type Notification,
} from '@emfts/core'
import {
  RiboFactory,
  FeatureOperation,
  isBodyModifier,
  isComponent,
  isConstructionPlane,
  isJoint,
  isFeature,
  isHole,
  isParameter,
  isProfileFeature,
  isRevolve,
  isSketch,
  isSketchConstraint,
  isSketchCurve,
  isSketchPoint,
  pointsOf,
  sketchOf,
  type Component,
  type ConstructionPlane,
  type Design,
  type EdgeFeature,
  type Feature,
  type Hole,
  type Joint,
  type JointOrigin,
  type Parameter,
  type ProfileFeature,
  type Sketch,
  type SketchConstraint,
  type SketchCurve,
  type Shell,
  type SketchPlane,
  type SketchPoint,
} from 'ribo-model'
import type {
  BuildPlan,
  BuildResult,
  DocumentService,
  FeatureProblem,
  Frame,
  KernelService,
  Matrix,
  PlanePick,
  SketchPlanFeature,
  SolveOutcome,
  Vec2,
  Vec3,
} from 'ribo-contracts'
import { evaluateExpression } from './expression'
import { History } from './History'
import { buildComponent, compilePlan, componentIndex, evaluateParameters, scopeOf, sketchCurves, sketchFrame, sketchRegions } from './plan'
import { movedBy, solveAssembly } from './kinematics'
import { IDENTITY, decompose, originFrame, regionAt } from 'ribo-geometry'
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
  readonly inputResult = shallowRef<BuildResult | undefined>()
  /** Placement of each component (0: the design itself) */
  readonly placements = shallowRef<Matrix[]>([IDENTITY])
  readonly freedom = shallowRef<(number | undefined)[]>([])

  private readonly factory = RiboFactory.eINSTANCE
  private readonly adapter: EContentAdapter
  private solver: SketchSolver | undefined
  /** While set, notifications are not counted as changes (saving touches the root) */
  private muted = false
  private updateQueued = false
  private compileProblems: FeatureProblem[] = []
  private solveProblems: FeatureProblem[] = []
  private assemblyProblems: FeatureProblem[] = []
  private buildTimer: ReturnType<typeof setTimeout> | undefined
  private buildRunning = false
  private buildAgain = false
  /** Which plan and timeline index inputResult was built for */
  private inputKey: { plan: BuildPlan; index: number } | undefined

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
    this.updateInput()
  }

  newDesign(): void {
    this.setDesign(this.createDesign())
  }

  load(text: string): void {
    // XMI starts with its XML declaration or root element; anything else is emfts JSON
    const xml = text.trimStart().startsWith('<')
    const resource = xml ? new XMIResource(URI.createURI('design.ribo.xmi')) : new JSONResource(URI.createURI('design.ribo.json'))
    resource.loadFromString(text)
    const root = resource.getContents().get(0)
    if (!root || root.eClass().getName() !== 'Design') throw new Error('Die Datei enthält kein ribo-Design')
    resource.getContents().clear()
    this.setDesign(root as Design)
  }

  save(format: 'json' | 'xmi' = 'json'): string {
    const design = this.design.value
    const resource = format === 'xmi' ? new XMIResource(URI.createURI('design.ribo.xmi')) : new JSONResource(URI.createURI('design.ribo.json'))
    this.muted = true
    try {
      return this.history.unrecorded(() => {
        resource.getContents().add(design)
        try {
          return format === 'xmi' ? resource.saveToString() : resource.saveToString(new Map([[OPTION_INDENT, 2]]))
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

  addSketch(plane: SketchPlane | ConstructionPlane, offset = '0'): Sketch {
    const sketch = this.factory.createSketch()
    sketch.name = this.nextFeatureName('Skizze')
    if (typeof plane === 'string') sketch.plane = plane
    else sketch.reference = plane
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
    let frame: Frame
    try {
      frame = sketchFrame(sketch, (_label, source) => this.evaluate(source ?? '0'))
    } catch {
      frame = originFrame(sketch.plane ?? 'XY')
    }
    const curves = sketchCurves(sketch)
    return { kind: 'sketch', index, frame, curves, regions: sketchRegions(curves), component: componentIndex(this.design.value, sketch.component) }
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

  setRollback(index: number, component?: Component): void {
    const design = this.design.value
    const owner = component ?? design
    const value = index < 0 || index >= design.features.size() ? -1 : index
    if ((owner.rollback ?? -1) === value) return
    this.history.record('Zeitleiste verschieben', () => {
      owner.rollback = value
    })
  }

  /** The design's and every component's timeline marker */
  private markerOwners(): { rollback: number }[] {
    const design = this.design.value
    return [design, ...design.components.toArray()]
  }

  // --------------------------------------------------------- modifications

  // ------------------------------------------------------------ assembly

  addComponent(): Component {
    const design = this.design.value
    const component = this.factory.createComponent()
    component.name = this.uniqueName(
      'Bauteil ',
      design.components.toArray().map((c) => c.name),
    )
    this.history.record('Neues Bauteil', () => {
      design.components.add(component)
      design.activeComponent = component
    })
    this.select(component)
    return component
  }

  activate(component: Component | undefined): void {
    const design = this.design.value
    if (design.activeComponent === component) return
    this.history.record('Bauteil aktivieren', () => {
      design.activeComponent = component as Component
    })
  }

  componentIndexOf(object: Component | Feature | undefined): number {
    if (!object) return 0
    if (isComponent(object)) return componentIndex(this.design.value, object)
    return buildComponent(this.design.value, object)
  }

  componentAt(index: number): Component | undefined {
    return index <= 0 ? undefined : this.design.value.components.get(index - 1)
  }

  addJoint(): Joint {
    const joint = this.factory.createJoint()
    joint.name = this.nextFeatureName('Gelenk')
    // Joints belong to the assembly, not to a component
    this.history.record('Gelenk', () => {
      const active = this.design.value.activeComponent
      this.design.value.activeComponent = undefined as never
      this.insertFeature(joint)
      this.design.value.activeComponent = active as Component
    })
    this.select(joint)
    return joint
  }

  setJointOrigin(joint: Joint, which: 'first' | 'second', component: number, origin: Vec3, z: Vec3, x: Vec3, kind: 'Face' | 'CircularEdge' | 'Edge' = 'Face'): void {
    const value: JointOrigin = this.factory.createJointOrigin()
    value.component = this.componentAt(component) as Component
    value.kind = kind
    ;[value.originX, value.originY, value.originZ] = origin
    ;[value.zX, value.zY, value.zZ] = z
    ;[value.xX, value.xY, value.xZ] = x
    this.history.record(joint.alignOnly ? 'Ausrichten' : 'Gelenkursprung', () => {
      joint[which] = value
      if (joint.alignOnly && joint.first && joint.second) this.bakeAlignment(joint)
    })
  }

  movedBy(joint: Joint): number {
    return movedBy(this.design.value, joint)
  }

  swapJointOrigins(joint: Joint): void {
    this.history.record('Bezüge tauschen', () => {
      const [first, second] = [joint.first, joint.second]
      joint.first = undefined as never
      joint.second = undefined as never
      joint.first = second as JointOrigin
      joint.second = first as JointOrigin
    })
  }

  /** Bakes a joint into its moving component's position and removes it */
  applyAlignment(joint: Joint): void {
    if (joint.alignOnly) {
      this.bakeAlignment(joint)
      return
    }
    this.history.record('In Lage übernehmen', () => this.bakeAlignment(joint))
  }

  /** The joint's placement becomes the component's own position; the joint goes */
  private bakeAlignment(joint: Joint): void {
    const design = this.design.value
    const evaluate = (_label: string, source: string | undefined) => this.evaluate(source ?? '0')
    const moving = this.componentAt(movedBy(design, joint))
    if (!moving) {
      // Both origins on the design itself: nothing can move
      this.removeNow(joint)
      return
    }
    const placed = solveAssembly(design, evaluate).placements[componentIndex(design, moving)]
    if (placed) {
      const { position, rotation } = decompose(placed)
      const round = (v: number) => String(Math.round(v * 1e4) / 1e4)
      ;[moving.positionX, moving.positionY, moving.positionZ] = position.map(round) as [string, string, string]
      ;[moving.rotationX, moving.rotationY, moving.rotationZ] = rotation.map(round) as [string, string, string]
    }
    this.removeNow(joint)
    if (this.selection.value === joint) this.selection.value = moving
  }

  /** An alignment: a rigid joint that stays in the timeline and can be edited */
  addAlignment(): Joint {
    const joint = this.factory.createJoint()
    joint.name = this.nextFeatureName('Ausrichtung')
    joint.kind = 'Rigid'
    this.history.record('Ausrichten', () => {
      const active = this.design.value.activeComponent
      this.design.value.activeComponent = undefined as never
      this.insertFeature(joint)
      this.design.value.activeComponent = active as Component
    })
    this.select(joint)
    return joint
  }

  addConstructionPlane(pick: PlanePick): ConstructionPlane {
    const plane = this.factory.createConstructionPlane()
    plane.name = this.nextFeatureName('Ebene')
    if (pick.kind === 'origin') {
      plane.base = pick.plane
      plane.offset = String(pick.offset)
    } else if (pick.kind === 'face') {
      plane.base = 'Face'
      ;[plane.originX, plane.originY, plane.originZ] = pick.origin
      ;[plane.normalX, plane.normalY, plane.normalZ] = pick.normal
    } else {
      plane.base = 'Plane'
      plane.reference = this.design.value.features.get(pick.index) as ConstructionPlane
    }
    this.history.record('Konstruktionsebene', () => this.insertFeature(plane))
    this.select(plane)
    return plane
  }

  addFillet(): EdgeFeature {
    const fillet = this.factory.createFillet()
    fillet.name = this.nextFeatureName('Abrundung')
    this.history.record('Abrunden', () => this.insertFeature(fillet))
    this.select(fillet)
    return fillet
  }

  addChamfer(): EdgeFeature {
    const chamfer = this.factory.createChamfer()
    chamfer.name = this.nextFeatureName('Fase')
    this.history.record('Fasen', () => this.insertFeature(chamfer))
    this.select(chamfer)
    return chamfer
  }

  addShell(): Shell {
    const shell = this.factory.createShell()
    shell.name = this.nextFeatureName('Schale')
    this.history.record('Schale', () => this.insertFeature(shell))
    this.select(shell)
    return shell
  }

  addHole(sketch?: Sketch): Hole {
    const hole = this.factory.createHole()
    hole.name = this.nextFeatureName('Bohrung')
    hole.preset = 'M3 Durchgang'
    hole.sketch = (sketch ?? sketchOf(this.selection.value) ?? this.design.value.features.toArray().filter(isSketch).at(-1)) as Sketch
    this.history.record('Bohrung', () => this.insertFeature(hole))
    this.select(hole)
    return hole
  }

  toggleEdge(feature: EdgeFeature, [x, y, z]: Vec3, existing?: number): void {
    this.history.record('Kante wählen', () => {
      if (existing !== undefined && existing >= 0 && existing < feature.edges.size()) {
        feature.edges.removeAt(existing)
        return
      }
      const edge = this.factory.createEdgeSelection()
      Object.assign(edge, { x, y, z })
      feature.edges.add(edge)
    })
  }

  toggleFace(feature: Shell, [x, y, z]: Vec3, existing?: number): void {
    this.history.record('Fläche wählen', () => {
      if (existing !== undefined && existing >= 0 && existing < feature.faces.size()) {
        feature.faces.removeAt(existing)
        return
      }
      const face = this.factory.createFaceSelection()
      Object.assign(face, { x, y, z })
      feature.faces.add(face)
    })
  }

  /** Builds the bodies before the selected edge or face feature, for picking on them */
  private updateInput(): void {
    const selected = this.selection.value
    if (!isBodyModifier(selected)) {
      this.inputKey = undefined
      this.inputResult.value = undefined
      return
    }
    const index = this.design.value.features.indexOf(selected)
    const plan = this.plan.value
    if (this.inputKey?.plan === plan && this.inputKey.index === index) return
    const key = { plan, index }
    this.inputKey = key
    const before: BuildPlan = { features: plan.features.filter((f) => f.index < index) }
    this.kernel.build(before).then(
      (result) => {
        if (this.inputKey === key) this.inputResult.value = result
      },
      () => {
        if (this.inputKey === key) this.inputResult.value = undefined
      },
    )
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
    // New features build in the active component
    if (!feature.component && design.activeComponent) feature.component = design.activeComponent
    const marker = (feature.component ?? design).rollback ?? -1
    if (marker >= 0) {
      design.features.addAt(marker, feature)
      // Everything from the insertion on moved one place: so do the markers there, this one included
      for (const owner of this.markerOwners()) if ((owner.rollback ?? -1) >= marker) owner.rollback = owner.rollback + 1
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
      if (isConstructionPlane(object)) {
        for (const feature of design.features.toArray()) {
          if ((isSketch(feature) || isConstructionPlane(feature)) && feature.reference === object) {
            // Without the plane a sketch falls back to its origin plane
            feature.reference = undefined as never
          }
        }
      }
      if (isSketch(object)) {
        for (const feature of design.features.toArray()) {
          if (isHole(feature) && feature.sketch === object) feature.sketch = undefined as unknown as Sketch
        }
        for (const feature of design.features.toArray().filter(isProfileFeature)) {
          if (feature.sketch !== object) continue
          feature.sketch = undefined as unknown as Sketch
          feature.profiles.clear()
          if (isRevolve(feature)) feature.axisLine = undefined as never
        }
      }
      const index = design.features.indexOf(object)
      design.features.remove(object)
      for (const owner of this.markerOwners()) {
        if ((owner.rollback ?? -1) > index) owner.rollback = owner.rollback - 1
        if ((owner.rollback ?? -1) >= design.features.size()) owner.rollback = -1
      }
      return
    }
    if (isParameter(object)) {
      design.parameters.remove(object)
      return
    }
    if (isComponent(object)) {
      // A component goes with its features and the joints holding it
      for (const feature of design.features.toArray()) {
        const holds = isJoint(feature) && (feature.first?.component === object || feature.second?.component === object)
        if (feature.component === object || holds) this.removeNow(feature)
      }
      if (design.activeComponent === object) design.activeComponent = undefined as never
      design.components.remove(object)
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
    const assembly = solveAssembly(design, (label, source) => {
      try {
        return this.evaluate(source ?? '0')
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`)
      }
    })
    this.placements.value = assembly.placements
    this.freedom.value = assembly.freedom
    this.assemblyProblems = assembly.problems
    this.compileProblems = compiled.problems
    this.problems.value = this.mergeProblems(this.result.value?.problems ?? [])
    // The solver's writes were muted; views keyed on the revision must still see them
    this.revision.value++
    triggerRef(this.design)
    this.updateInput()

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
    return [...this.solveProblems, ...this.compileProblems, ...this.assemblyProblems, ...buildProblems].sort((a, b) => a.index - b.index)
  }
}
