import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { frameFromNormal, originFrame } from 'ribo-geometry'
import {
  type AnalysisLayer,
  type Frame,
  type BodyMesh,
  type BuildPlan,
  type PlanCurve,
  type PlanPlane,
  type PlanePick,
  type PlanRegion,
  type SketchPlanFeature,
  type SketchView,
  type Vec2,
  type Vec3,
} from 'ribo-contracts'

export type ViewDirection = 'iso' | 'top' | 'front' | 'right'

export interface SceneColors {
  body: string
  edge: string
  sketch: string
  construction: string
  highlight: string
  region: string
  regionPicked: string
  plane: string
  grid: string
  gridMinor: string
}

const VIEW_VECTORS: Record<ViewDirection, THREE.Vector3> = {
  iso: new THREE.Vector3(1, -1, 0.8),
  top: new THREE.Vector3(0, 0, 1),
  front: new THREE.Vector3(0, -1, 0),
  right: new THREE.Vector3(1, 0, 0),
}

/** Pointer travel below which a press counts as a click, not a drag */
const CLICK_TOLERANCE_PX = 4
const CAMERA_ANIMATION_MS = 280
const COMPONENT_COLORS = ['#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fb7185', '#facc15']
/** Screen distance within which an edge counts as under the pointer */
const EDGE_PICK_PX = 8
/** How far a remembered pick may lie from the edge or face it stands for, mm */
const PICK_MATCH_MM = 0.5

/** One B-rep edge of a body mesh as a polyline */
interface EdgeLine {
  points: THREE.Vector3[]
  midpoint: THREE.Vector3
}

/** One B-rep face of a body mesh as triangles */
interface FaceTriangles {
  triangles: THREE.Triangle[]
}

function edgeLines(data: BodyMesh): EdgeLine[] {
  return data.edgeGroups.map(({ start, count }) => {
    const points: THREE.Vector3[] = []
    for (let i = start; i + 2 < start + count; i += 3) points.push(new THREE.Vector3(data.edges[i], data.edges[i + 1], data.edges[i + 2]))
    // Segments come as pairs; drop the repeated joints
    const unique = points.filter((p, i) => i === 0 || !p.equals(points[i - 1]!))
    return { points: unique, midpoint: polylineMidpoint(unique) }
  })
}

function polylineMidpoint(points: THREE.Vector3[]): THREE.Vector3 {
  let total = 0
  for (let i = 1; i < points.length; i++) total += points[i]!.distanceTo(points[i - 1]!)
  let walked = 0
  for (let i = 1; i < points.length; i++) {
    const length = points[i]!.distanceTo(points[i - 1]!)
    if (walked + length >= total / 2) return points[i - 1]!.clone().lerp(points[i]!, (total / 2 - walked) / (length || 1))
    walked += length
  }
  return points[0]?.clone() ?? new THREE.Vector3()
}

function faceTriangles(data: BodyMesh): FaceTriangles[] {
  const v = (i: number) => new THREE.Vector3(data.vertices[i * 3], data.vertices[i * 3 + 1], data.vertices[i * 3 + 2])
  return data.faces.map(({ start, count }) => {
    const triangles: THREE.Triangle[] = []
    for (let i = start; i < start + count; i += 3) triangles.push(new THREE.Triangle(v(data.triangles[i]!), v(data.triangles[i + 1]!), v(data.triangles[i + 2]!)))
    return { triangles }
  })
}

function distanceToPolyline(p: THREE.Vector3, points: THREE.Vector3[]): number {
  let best = Infinity
  const segment = new THREE.Line3()
  const closest = new THREE.Vector3()
  for (let i = 1; i < points.length; i++) {
    segment.set(points[i - 1]!, points[i]!)
    segment.closestPointToPoint(p, true, closest)
    best = Math.min(best, closest.distanceTo(p))
  }
  return best
}

/** The circle a polyline runs on, when it does: centre, axis and a point on it */
function circleOf(points: THREE.Vector3[]): { center: THREE.Vector3; normal: THREE.Vector3; start: THREE.Vector3 } | undefined {
  if (points.length < 4) return undefined
  const a = points[0]!
  const b = points[Math.floor(points.length / 3)]!
  const c = points[Math.floor((2 * points.length) / 3)]!
  const ab = b.clone().sub(a)
  const ac = c.clone().sub(a)
  const normal = ab.clone().cross(ac)
  if (normal.lengthSq() < 1e-12) return undefined
  // Circumcentre of the triangle a, b, c
  const center = a
    .clone()
    .add(
      ab
        .clone()
        .multiplyScalar(ac.lengthSq())
        .sub(ac.clone().multiplyScalar(ab.lengthSq()))
        .cross(normal)
        .divideScalar(2 * normal.lengthSq())
        .negate(),
    )
  normal.normalize()
  const radius = center.distanceTo(a)
  const fits = points.every((p) => Math.abs(p.distanceTo(center) - radius) < 1e-3 * Math.max(1, radius) && Math.abs(p.clone().sub(center).dot(normal)) < 1e-3)
  return fits ? { center, normal, start: a } : undefined
}

/** Area-weighted centre of a face's triangles */
function faceCentre(face: FaceTriangles): THREE.Vector3 {
  const sum = new THREE.Vector3()
  let area = 0
  const centroid = new THREE.Vector3()
  for (const triangle of face.triangles) {
    const a = triangle.getArea()
    triangle.getMidpoint(centroid)
    sum.addScaledVector(centroid, a)
    area += a
  }
  return area > 0 ? sum.divideScalar(area) : sum
}

/** A joint origin found on geometry, in the coordinates of its component */
export interface JointOriginPick {
  component: number
  origin: Vec3
  z: Vec3
  x: Vec3
}

function distanceToFace(p: THREE.Vector3, face: FaceTriangles): number {
  let best = Infinity
  const closest = new THREE.Vector3()
  for (const triangle of face.triangles) {
    triangle.closestPointToPoint(p, closest)
    best = Math.min(best, closest.distanceTo(p))
  }
  return best
}

const v3 = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2])

/** Sketch coordinates to world coordinates */
export function sketchToWorld(frame: Frame, [u, v]: Vec2): THREE.Vector3 {
  return v3(frame.origin)
    .add(v3(frame.x).multiplyScalar(u))
    .add(v3(frame.y).multiplyScalar(v))
}

/** World coordinates (on or near the plane) to sketch coordinates */
export function worldToSketch(frame: Frame, point: THREE.Vector3): Vec2 {
  const d = point.clone().sub(v3(frame.origin))
  return [d.dot(v3(frame.x)), d.dot(v3(frame.y))]
}

/** Polyline points of a curve, for display */
function curvePoints(curve: PlanCurve): Vec2[] {
  if (curve.kind === 'line') return [curve.from, curve.to]
  const [cx, cy] = curve.center
  let a0 = 0
  let sweep = Math.PI * 2
  if (curve.kind === 'arc') {
    a0 = Math.atan2(curve.from[1] - cy, curve.from[0] - cx)
    const a1 = Math.atan2(curve.to[1] - cy, curve.to[0] - cx)
    sweep = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
  }
  const n = Math.max(8, Math.ceil((sweep / (2 * Math.PI)) * 96))
  return [...Array(n + 1).keys()].map((i) => {
    const a = a0 + (sweep * i) / n
    return [cx + curve.radius * Math.cos(a), cy + curve.radius * Math.sin(a)] as Vec2
  })
}

function regionShape(region: PlanRegion): THREE.Shape {
  const shape = new THREE.Shape(region.outline.map(([u, v]) => new THREE.Vector2(u, v)))
  for (const hole of region.holeOutlines) shape.holes.push(new THREE.Path(hole.map(([u, v]) => new THREE.Vector2(u, v))))
  return shape
}

/** Matrix that places plane-local (u, v, 0) shapes onto a sketch plane */
function planeMatrix(frame: Frame): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(v3(frame.x), v3(frame.y), v3(frame.normal))
  m.setPosition(v3(frame.origin))
  return m
}

interface PickTarget {
  object: THREE.Object3D
  /** What a click on this object means */
  resolve(hit: THREE.Intersection): PickResult | undefined
}

type PickResult = { kind: 'plane'; pick: PlanePick; highlight: THREE.Object3D } | { kind: 'region'; point: Vec2; highlight: THREE.Object3D }

export interface SceneCallbacks {
  /** The 2D view changed (pan, zoom, resize) */
  onSketchView(view: SketchView | undefined): void
  /** A profile region was clicked while profile picking */
  onRegionClick(point: Vec2): void
  /** An edge was clicked while edge picking; `existing` is the index of the pick it matches */
  onEdgeClick(midpoint: Vec3, existing: number | undefined): void
  /** A face was clicked while face picking */
  onFaceClick(point: Vec3, existing: number | undefined): void
  /** A joint origin was picked on a circular edge or a flat face */
  onJointOrigin(pick: JointOriginPick): void
}

/** Edges or faces offered for picking, with the picks made so far */
export interface ModifierPicking {
  mode: 'edges' | 'faces'
  picks: Vec3[]
}

/**
 * The three.js side of the viewport. Z is up, like on a print bed.
 *
 * Two cameras: a perspective one for the model, an orthographic one looking
 * straight at the sketch plane while a sketch is edited.
 */
export class SceneView {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20000)
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000)
  private readonly controls: OrbitControls
  private readonly bodies = new THREE.Group()
  private readonly sketches = new THREE.Group()
  private readonly regions = new THREE.Group()
  private readonly pickers = new THREE.Group()
  private readonly hover = new THREE.Group()
  private readonly grid = new THREE.Group()
  private readonly analysis = new THREE.Group()
  private readonly constructionPlanes = new THREE.Group()
  private readonly analysisLayers = new Map<string, THREE.Mesh>()
  private bed: Vec3 = [220, 220, 250]
  private readonly axes = new THREE.AxesHelper(25)
  private readonly resizeObserver: ResizeObserver
  private readonly raycaster = new THREE.Raycaster()
  private frame = 0
  private bounds = new THREE.Box3()
  private bodyMeshes: { mesh: THREE.Mesh; data: BodyMesh; edges: EdgeLine[]; faces: FaceTriangles[] }[] = []
  /** Bodies the edges and faces are picked on, when they differ from the shown ones */
  private pickSource: { mesh: THREE.Mesh; data: BodyMesh; edges: EdgeLine[]; faces: FaceTriangles[] }[] | undefined
  /** Edges of the pick bodies, drawn faintly over the shown result */
  private readonly ghost = new THREE.Group()
  private readonly picked = new THREE.Group()
  /** Placement per component index; bodies, sketches and planes are drawn where their component sits */
  private placements: THREE.Matrix4[] = []
  /** Component new sketches go into: origin planes and face picks are in its coordinates */
  private activeComponent = 0
  private modifier: ModifierPicking | undefined
  private jointPicking = false
  private readonly jointMarkers = new THREE.Group()
  private readonly lineMaterials: LineMaterial[] = []
  private width = 1
  private height = 1

  private view2d: SketchView | undefined
  private saved3d: { position: THREE.Vector3; target: THREE.Vector3 } | undefined
  private animation = 0

  private pickTargets: PickTarget[] = []
  private planePickResolve: ((pick: PlanePick | undefined) => void) | undefined
  private pressed: { x: number; y: number; button: number; panning: boolean } | undefined

  /**
   * @param container where the canvas goes
   * @param input element receiving pointer input - the container plus anything drawn over it
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly input: HTMLElement,
    private colors: SceneColors,
    private readonly callbacks: SceneCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(this.renderer.domElement)

    this.camera.up.set(0, 0, 1)
    this.camera.position.set(160, -160, 130)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    // Direct, without inertia: the view stops where the mouse stops
    this.controls.enableDamping = false
    this.controls.zoomToCursor = true
    this.controls.screenSpacePanning = true
    this.controls.rotateSpeed = 0.8
    this.controls.zoomSpeed = 1.2
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    this.controls.addEventListener('change', () => this.requestRender())

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.7)
    sun.position.set(0.5, -0.3, 1)
    this.camera.add(sun)
    this.ortho.add(sun.clone())
    this.scene.add(this.camera, this.ortho)

    this.scene.add(this.grid, this.bodies, this.regions, this.sketches, this.pickers, this.ghost, this.picked, this.hover, this.analysis, this.constructionPlanes, this.jointMarkers, this.axes)
    this.buildGrid()

    const canvas = this.renderer.domElement
    input.addEventListener('pointerdown', this.onPointerDown)
    input.addEventListener('pointermove', this.onPointerMove)
    input.addEventListener('pointerup', this.onPointerUp)
    input.addEventListener('wheel', this.onWheel, { passive: false })
    input.addEventListener('contextmenu', this.onContextMenu)
    canvas.style.touchAction = 'none'

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.animation)
    this.planePickResolve?.(undefined)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.input.removeEventListener('pointerdown', this.onPointerDown)
    this.input.removeEventListener('pointermove', this.onPointerMove)
    this.input.removeEventListener('pointerup', this.onPointerUp)
    this.input.removeEventListener('wheel', this.onWheel)
    this.input.removeEventListener('contextmenu', this.onContextMenu)
    for (const group of [this.bodies, this.sketches, this.regions, this.pickers, this.ghost, this.picked, this.hover, this.analysis, this.constructionPlanes, this.jointMarkers, this.grid]) clearGroup(group)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  setColors(colors: SceneColors): void {
    this.colors = colors
    clearGroup(this.grid)
    this.buildGrid()
    this.requestRender()
  }

  // ---------------------------------------------------------------- content

  setPlacements(placements: number[][], active: number): void {
    this.placements = placements.map((m) => new THREE.Matrix4().fromArray(m))
    this.activeComponent = active
  }

  private matrixOf(component: number): THREE.Matrix4 {
    return this.placements[component] ?? new THREE.Matrix4()
  }

  /** Places an object built in component coordinates */
  private place<T extends THREE.Object3D>(object: T, component: number): T {
    object.matrixAutoUpdate = false
    object.matrix.premultiply(this.matrixOf(component))
    object.matrixWorldNeedsUpdate = true
    return object
  }

  setBodies(meshes: BodyMesh[]): void {
    clearGroup(this.bodies)
    this.bodyMeshes = []
    this.bounds = new THREE.Box3()
    for (const data of meshes) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1))
      const material = new THREE.MeshStandardMaterial({
        // Each component its own colour, so an assembly reads at a glance
        color: data.component === 0 ? this.colors.body : COMPONENT_COLORS[(data.component - 1) % COMPONENT_COLORS.length]!,
        roughness: 0.55,
        metalness: 0.05,
        // Both sides: a face OpenCascade hands over reversed must not vanish
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      })
      const mesh = this.place(new THREE.Mesh(geometry, material), data.component)
      mesh.updateMatrixWorld(true)
      this.bodies.add(mesh)
      this.bodyMeshes.push({ mesh, data, edges: edgeLines(data), faces: faceTriangles(data) })

      const edgeGeometry = new THREE.BufferGeometry()
      edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.edges, 3))
      this.bodies.add(this.place(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: this.colors.edge })), data.component))

      const [minX, minY, minZ, maxX, maxY, maxZ] = data.bounds
      this.bounds.union(new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)).applyMatrix4(this.matrixOf(data.component)))
    }
    this.showPicked()
    this.requestRender()
  }

  // ------------------------------------------------------- edge/face pick

  private get pickBodies() {
    return this.pickSource ?? this.bodyMeshes
  }

  /**
   * Bodies to pick edges and faces on while others are shown - the state
   * before a fillet while its result is previewed. Undefined picks on the
   * shown bodies.
   */
  setPickBodies(meshes: BodyMesh[] | undefined): void {
    clearGroup(this.ghost)
    for (const { mesh } of this.pickSource ?? []) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    if (!meshes) {
      this.pickSource = undefined
    } else {
      this.pickSource = meshes.map((data) => {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3))
        geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1))
        // Never added to the scene: only raycast against
        const mesh = this.place(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()), data.component)
        mesh.updateMatrixWorld(true)
        const edgeGeometry = new THREE.BufferGeometry()
        edgeGeometry.setAttribute('position', new THREE.BufferAttribute(data.edges, 3))
        const ghost = new THREE.LineSegments(
          edgeGeometry,
          new THREE.LineBasicMaterial({ color: this.colors.highlight, transparent: true, opacity: 0.45, depthTest: false }),
        )
        ghost.renderOrder = 6
        this.ghost.add(this.place(ghost, data.component))
        return { mesh, data, edges: edgeLines(data), faces: faceTriangles(data) }
      })
    }
    this.showPicked()
    this.requestRender()
  }

  // ------------------------------------------------------------ joints

  /** Offers circular edges and flat faces as joint origins */
  setJointPicking(on: boolean): void {
    this.jointPicking = on
    clearGroup(this.hover)
    this.requestRender()
  }

  /** Axis triads at joint origins, in assembly coordinates */
  setJointMarkers(markers: { origin: Vec3; z: Vec3; x: Vec3; component: number }[]): void {
    clearGroup(this.jointMarkers)
    for (const marker of markers) this.jointMarkers.add(this.place(this.triad(marker.origin, marker.z, marker.x, 12), marker.component))
    this.requestRender()
  }

  private triad(origin: Vec3, z: Vec3, x: Vec3, size: number): THREE.Object3D {
    const group = new THREE.Group()
    const o = v3(origin)
    const zAxis = v3(z).normalize()
    const xAxis = v3(x).normalize()
    const yAxis = zAxis.clone().cross(xAxis)
    for (const [axis, color] of [
      [xAxis, '#ef4444'],
      [yAxis, '#22c55e'],
      [zAxis, '#3b82f6'],
    ] as const) {
      const geometry = new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(axis, size)])
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }))
      line.renderOrder = 12
      group.add(line)
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12), new THREE.MeshBasicMaterial({ color: this.colors.highlight, depthTest: false, transparent: true }))
    dot.position.copy(o)
    dot.renderOrder = 12
    group.add(dot)
    return group
  }

  /** The joint origin under the pointer: a circular edge's centre first, else the centre of a flat face */
  private jointOriginAt(event: PointerEvent): { pick: JointOriginPick; highlight: THREE.Object3D } | undefined {
    const edge = this.edgeAt(event)
    if (edge) {
      const body = this.pickBodies[edge.body]!
      const circle = circleOf(body.edges[edge.edge]!.points)
      if (circle) {
        const x = circle.start.clone().sub(circle.center).normalize()
        const pick: JointOriginPick = { component: body.data.component, origin: circle.center.toArray() as Vec3, z: circle.normal.toArray() as Vec3, x: x.toArray() as Vec3 }
        const highlight = new THREE.Group()
        highlight.add(this.thickLine(body.edges[edge.edge]!.points, this.colors.highlight), this.triad(pick.origin, pick.z, pick.x, 8))
        return { pick, highlight: this.place(highlight, pick.component) }
      }
    }
    const face = this.faceAt(event)
    if (!face) return undefined
    const body = this.pickBodies[face.body]!
    const plane = body.data.faces[face.face]?.plane
    if (!plane) return undefined
    const centre = faceCentre(body.faces[face.face]!)
    const frame = frameFromNormal(centre.toArray() as Vec3, plane.normal)
    const pick: JointOriginPick = { component: body.data.component, origin: centre.toArray() as Vec3, z: frame.normal, x: frame.x }
    const highlight = new THREE.Group()
    highlight.add(this.faceHighlight(body.data, face.face, this.colors.highlight, 0.35), this.triad(pick.origin, pick.z, pick.x, 8))
    return { pick, highlight: this.place(highlight, pick.component) }
  }

  /** Offers edges or faces for picking (for fillet, chamfer, shell), or stops with undefined */
  setModifierPicking(picking: ModifierPicking | undefined): void {
    this.modifier = picking
    clearGroup(this.hover)
    this.showPicked()
    this.requestRender()
  }

  /** Index of the edge line a remembered midpoint stands for */
  private matchEdge(point: Vec3): { body: number; edge: number } | undefined {
    const p = v3(point)
    let best: { body: number; edge: number } | undefined
    let bestDistance = PICK_MATCH_MM
    this.pickBodies.forEach(({ edges }, body) =>
      edges.forEach((line, edge) => {
        const d = distanceToPolyline(p, line.points)
        if (d <= bestDistance) {
          best = { body, edge }
          bestDistance = d
        }
      }),
    )
    return best
  }

  private matchFace(point: Vec3): { body: number; face: number } | undefined {
    const p = v3(point)
    let best: { body: number; face: number } | undefined
    let bestDistance = PICK_MATCH_MM
    this.pickBodies.forEach(({ faces }, body) =>
      faces.forEach((triangles, face) => {
        const d = distanceToFace(p, triangles)
        if (d <= bestDistance) {
          best = { body, face }
          bestDistance = d
        }
      }),
    )
    return best
  }

  /** Highlights the picks made so far */
  private showPicked(): void {
    clearGroup(this.picked)
    const modifier = this.modifier
    if (!modifier) return
    for (const pick of modifier.picks) {
      if (modifier.mode === 'edges') {
        const hit = this.matchEdge(pick)
        if (hit) this.picked.add(this.place(this.thickLine(this.pickBodies[hit.body]!.edges[hit.edge]!.points, this.colors.regionPicked), this.pickBodies[hit.body]!.data.component))
      } else {
        const hit = this.matchFace(pick)
        if (hit) this.picked.add(this.place(this.faceHighlight(this.pickBodies[hit.body]!.data, hit.face, this.colors.regionPicked, 0.55), this.pickBodies[hit.body]!.data.component))
      }
    }
  }

  private thickLine(points: THREE.Vector3[], color: string): THREE.Object3D {
    const positions: number[] = []
    for (let i = 1; i < points.length; i++) positions.push(...points[i - 1]!.toArray(), ...points[i]!.toArray())
    const geometry = new LineSegmentsGeometry().setPositions(positions)
    const material = new LineMaterial({ color, linewidth: 4, depthTest: false, transparent: true })
    material.resolution.set(this.width, this.height)
    this.lineMaterials.push(material)
    material.addEventListener('dispose', () => this.lineMaterials.splice(this.lineMaterials.indexOf(material), 1))
    const line = new LineSegments2(geometry, material)
    line.renderOrder = 8
    return line
  }

  private faceHighlight(data: BodyMesh, faceIndex: number, color: string, opacity: number): THREE.Object3D {
    const face = data.faces[faceIndex]!
    const positions = new Float32Array(face.count * 3)
    for (let i = 0; i < face.count; i++) {
      const vertex = data.triangles[face.start + i]!
      positions.set(data.vertices.subarray(vertex * 3, vertex * 3 + 3), i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide }))
    mesh.renderOrder = 7
    return mesh
  }

  /** The edge nearest to the pointer on screen, within EDGE_PICK_PX */
  private edgeAt(event: PointerEvent): { body: number; edge: number } | undefined {
    const rect = this.container.getBoundingClientRect()
    const mouse = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top)
    const toScreen = (p: THREE.Vector3) => {
      const ndc = p.clone().project(this.camera)
      return new THREE.Vector2(((ndc.x + 1) / 2) * this.width, ((1 - ndc.y) / 2) * this.height)
    }
    let best: { body: number; edge: number } | undefined
    let bestDistance = EDGE_PICK_PX
    this.pickBodies.forEach(({ edges, data }, body) =>
      edges.forEach((line, edge) => {
        const matrix = this.matrixOf(data.component)
        const screen = line.points.map((p) => toScreen(p.clone().applyMatrix4(matrix)))
        for (let i = 1; i < screen.length; i++) {
          const a = screen[i - 1]!
          const b = screen[i]!
          const ab = b.clone().sub(a)
          const t = Math.max(0, Math.min(1, mouse.clone().sub(a).dot(ab) / (ab.lengthSq() || 1)))
          const d = a.clone().add(ab.multiplyScalar(t)).distanceTo(mouse)
          if (d < bestDistance) {
            best = { body, edge }
            bestDistance = d
          }
        }
      }),
    )
    return best
  }

  /** The face under the pointer */
  private faceAt(event: PointerEvent): { body: number; face: number; point: THREE.Vector3 } | undefined {
    const rect = this.container.getBoundingClientRect()
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    const [hit] = this.raycaster.intersectObjects(
      this.pickBodies.map((b) => b.mesh),
      false,
    )
    if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return undefined
    const body = this.pickBodies.findIndex((b) => b.mesh === hit.object)
    const index = hit.faceIndex * 3
    const data = this.pickBodies[body]!.data
    const face = data.faces.findIndex((f) => index >= f.start && index < f.start + f.count)
    // Picks are kept in the coordinates of the body's component
    const local = hit.point.clone().applyMatrix4(this.matrixOf(data.component).clone().invert())
    return face < 0 ? undefined : { body, face, point: local }
  }

  private hoverModifier(event: PointerEvent): void {
    clearGroup(this.hover)
    const modifier = this.modifier!
    let found = false
    if (modifier.mode === 'edges') {
      const hit = this.edgeAt(event)
      if (hit) {
        this.hover.add(this.place(this.thickLine(this.pickBodies[hit.body]!.edges[hit.edge]!.points, this.colors.highlight), this.pickBodies[hit.body]!.data.component))
        found = true
      }
    } else {
      const hit = this.faceAt(event)
      if (hit) {
        this.hover.add(this.place(this.faceHighlight(this.pickBodies[hit.body]!.data, hit.face, this.colors.highlight, 0.45), this.pickBodies[hit.body]!.data.component))
        found = true
      }
    }
    this.input.style.cursor = found ? 'pointer' : ''
    this.requestRender()
  }

  private clickModifier(event: PointerEvent): void {
    const modifier = this.modifier!
    if (modifier.mode === 'edges') {
      const hit = this.edgeAt(event)
      if (!hit) return
      const existing = modifier.picks.findIndex((pick) => {
        const match = this.matchEdge(pick)
        return match?.body === hit.body && match.edge === hit.edge
      })
      const midpoint = this.pickBodies[hit.body]!.edges[hit.edge]!.midpoint
      this.callbacks.onEdgeClick(midpoint.toArray() as Vec3, existing >= 0 ? existing : undefined)
    } else {
      const hit = this.faceAt(event)
      if (!hit) return
      const existing = modifier.picks.findIndex((pick) => {
        const match = this.matchFace(pick)
        return match?.body === hit.body && match.face === hit.face
      })
      this.callbacks.onFaceClick(hit.point.toArray() as Vec3, existing >= 0 ? existing : undefined)
    }
  }

  /**
   * Draws sketch curves. `visible` lists the timeline indexes to show; the
   * highlighted one is drawn in the highlight colour.
   */
  setSketches(plan: BuildPlan, visible: Set<number>, highlighted?: number): void {
    clearGroup(this.sketches)
    for (const feature of plan.features) {
      if (feature.kind !== 'sketch' || !visible.has(feature.index)) continue
      const highlight = feature.index === highlighted
      for (const curve of feature.curves) {
        const points = curvePoints(curve).map((p) => sketchToWorld(feature.frame, p))
        const geometry = new THREE.BufferGeometry().setFromPoints(points)
        const color = highlight ? this.colors.highlight : curve.construction ? this.colors.construction : this.colors.sketch
        const material = curve.construction
          ? new THREE.LineDashedMaterial({ color, dashSize: 1.5, gapSize: 1, depthTest: false, transparent: true })
          : new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })
        const line = this.place(new THREE.Line(geometry, material), feature.component)
        if (curve.construction) line.computeLineDistances()
        line.renderOrder = 10
        this.sketches.add(line)
      }
    }
    this.requestRender()
  }

  /**
   * Shows the regions of a sketch as clickable fills, the picked ones
   * stronger. Without a sketch the region display is cleared.
   */
  setProfileRegions(sketch: SketchPlanFeature | undefined, picked: Set<number>): void {
    clearGroup(this.regions)
    this.pickTargets = this.pickTargets.filter((t) => !t.object.userData.region)
    if (!sketch) {
      this.requestRender()
      return
    }
    const matrix = this.matrixOf(sketch.component).clone().multiply(planeMatrix(sketch.frame))
    const toLocal = this.matrixOf(sketch.component).clone().invert()
    sketch.regions.forEach((region, index) => {
      const geometry = new THREE.ShapeGeometry(regionShape(region))
      const isPicked = picked.has(index)
      const material = new THREE.MeshBasicMaterial({
        color: isPicked ? this.colors.regionPicked : this.colors.region,
        transparent: true,
        opacity: isPicked ? 0.55 : 0.18,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.applyMatrix4(matrix)
      mesh.renderOrder = 5
      mesh.userData.region = index
      this.regions.add(mesh)
      this.pickTargets.push({
        object: mesh,
        resolve: (hit) => {
          const highlight = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: this.colors.highlight, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false }),
          )
          highlight.applyMatrix4(matrix)
          highlight.renderOrder = 6
          highlight.userData.sharedGeometry = true
          return { kind: 'region', point: worldToSketch(sketch.frame, hit.point.clone().applyMatrix4(toLocal)), highlight }
        },
      })
    })
    this.requestRender()
  }

  // ------------------------------------------------------------ plane pick

  /** Shows the origin planes and lets the user click one, or a flat face */
  pickPlane(): Promise<PlanePick | undefined> {
    this.planePickResolve?.(undefined)
    clearGroup(this.pickers)
    this.pickTargets = this.pickTargets.filter((t) => t.object.userData.region !== undefined)

    const size = Math.max(40, this.bounds.isEmpty() ? 60 : this.bounds.getSize(new THREE.Vector3()).length() * 0.6)
    for (const plane of ['XY', 'XZ', 'YZ'] as PlanPlane[]) {
      const geometry = new THREE.PlaneGeometry(size, size)
      geometry.translate(size / 2, size / 2, 0)
      const quad = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: this.colors.plane, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      )
      quad.applyMatrix4(this.matrixOf(this.activeComponent).clone().multiply(planeMatrix(originFrame(plane))))
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: this.colors.plane }))
      outline.applyMatrix4(this.matrixOf(this.activeComponent).clone().multiply(planeMatrix(originFrame(plane))))
      this.pickers.add(quad, outline)
      this.pickTargets.push({
        object: quad,
        resolve: () => {
          const highlight = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({ color: this.colors.highlight, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
          )
          highlight.applyMatrix4(this.matrixOf(this.activeComponent).clone().multiply(planeMatrix(originFrame(plane))))
          highlight.userData.sharedGeometry = true
          return { kind: 'plane', pick: { kind: 'origin', plane, offset: 0 }, highlight }
        },
      })
    }
    for (const { mesh, data } of this.bodyMeshes) {
      this.pickTargets.push({ object: mesh, resolve: (hit) => this.resolveFace(data, hit) })
    }
    for (const quad of this.constructionPlanes.children) {
      if (!(quad instanceof THREE.Mesh)) continue
      const index = quad.userData.planeIndex as number
      this.pickTargets.push({
        object: quad,
        resolve: () => {
          const highlight = new THREE.Mesh(
            quad.geometry,
            new THREE.MeshBasicMaterial({ color: this.colors.highlight, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
          )
          highlight.applyMatrix4(quad.matrix)
          highlight.userData.sharedGeometry = true
          return { kind: 'plane', pick: { kind: 'construction', index }, highlight }
        },
      })
    }
    this.requestRender()
    return new Promise((resolve) => {
      this.planePickResolve = resolve
    })
  }

  cancelPick(): void {
    this.finishPlanePick(undefined)
  }

  private finishPlanePick(pick: PlanePick | undefined) {
    const resolve = this.planePickResolve
    this.planePickResolve = undefined
    clearGroup(this.pickers)
    clearGroup(this.hover)
    this.pickTargets = this.pickTargets.filter((t) => t.object.userData.region !== undefined)
    this.requestRender()
    resolve?.(pick)
  }

  /** A flat body face parallel to an origin plane becomes that plane with an offset */
  private resolveFace(data: BodyMesh, hit: THREE.Intersection): PickResult | undefined {
    if (hit.faceIndex === undefined || hit.faceIndex === null) return undefined
    const index = hit.faceIndex * 3
    const face = data.faces.find((f) => index >= f.start && index < f.start + f.count)
    if (!face?.plane) return undefined
    // From the body's component into the coordinates of the active component, where the sketch will live
    const toActive = this.matrixOf(this.activeComponent).clone().invert().multiply(this.matrixOf(data.component))
    const normal = v3(face.plane.normal).transformDirection(toActive)
    const origin = v3(face.plane.origin).applyMatrix4(toActive)
    const point = hit.point.clone().applyMatrix4(this.matrixOf(this.activeComponent).clone().invert())
    const [nx, ny, nz] = normal.toArray()
    const [ox, oy, oz] = origin.toArray()
    const round = (value: number) => Math.round(value * 1e6) / 1e6
    // Faces parallel to an origin plane become that plane with an offset; others a plane of their own
    let pick: PlanePick
    if (Math.abs(nz) > 0.9999) pick = { kind: 'origin', plane: 'XY', offset: round(oz) }
    else if (Math.abs(ny) > 0.9999) pick = { kind: 'origin', plane: 'XZ', offset: round(-oy) }
    else if (Math.abs(nx) > 0.9999) pick = { kind: 'origin', plane: 'YZ', offset: round(ox) }
    else pick = { kind: 'face', origin: point.toArray() as Vec3, normal: [nx, ny, nz] }

    const positions = new Float32Array(face.count * 3)
    for (let i = 0; i < face.count; i++) {
      const vertex = data.triangles[face.start + i]!
      positions.set(data.vertices.subarray(vertex * 3, vertex * 3 + 3), i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const highlight = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: this.colors.highlight, transparent: true, opacity: 0.6, depthTest: false, side: THREE.DoubleSide }),
    )
    highlight.renderOrder = 7
    return { kind: 'plane', pick, highlight: this.place(highlight, data.component) }
  }

  // ---------------------------------------------------------------- camera

  /** Points the camera along a view direction at the bodies (or the bed). */
  view(direction: ViewDirection = 'iso'): void {
    if (this.view2d) {
      this.fitSketchView()
      return
    }
    const box = this.bounds.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 30)) : this.bounds
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 10)
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const offset = VIEW_VECTORS[direction].clone().normalize().multiplyScalar(distance * 1.1)
    if (direction === 'top') offset.y -= distance * 1e-3
    this.animateTo(center.clone().add(offset), center)
  }

  hasBodies(): boolean {
    return !this.bounds.isEmpty()
  }

  /** Turns to look straight at the plane, then switches to the flat 2D view */
  enterSketchView(frame: Frame): void {
    if (!this.view2d) this.saved3d = { position: this.camera.position.clone(), target: this.controls.target.clone() }
    const n = v3(frame.normal)
    // Keep looking at the same spot, moved onto the plane
    const target = this.controls.target.clone()
    target.sub(n.clone().multiplyScalar(target.clone().sub(v3(frame.origin)).dot(n)))
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.controls.enabled = false
    this.grid.visible = false
    this.constructionPlanes.visible = false
    this.animateTo(target.clone().add(n.clone().multiplyScalar(distance)), target, frame.y, () => {
      const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
      this.view2d = {
        frame,
        center: worldToSketch(frame, target),
        scale: this.height / visibleHeight,
        width: this.width,
        height: this.height,
      }
      this.applySketchView()
    })
  }

  exitSketchView(): void {
    if (!this.view2d && !this.saved3d) return
    const frame = this.view2d?.frame
    this.view2d = undefined
    this.callbacks.onSketchView(undefined)
    this.grid.visible = true
    this.constructionPlanes.visible = true
    this.controls.enabled = true
    const saved = this.saved3d
    this.saved3d = undefined
    if (frame) this.camera.up.set(...frame.y)
    if (saved) this.animateTo(saved.position, saved.target)
    else this.requestRender()
  }

  private fitSketchView(): void {
    const view = this.view2d
    if (!view) return
    const sketchBox = new THREE.Box3().setFromObject(this.sketches)
    const box = sketchBox.isEmpty() ? this.bounds : sketchBox
    if (box.isEmpty()) {
      view.center = [0, 0]
      view.scale = Math.min(this.width, this.height) / 120
    } else {
      const corners = [box.min, box.max].map((p) => worldToSketch(view.frame, p))
      const w = Math.abs(corners[1]![0] - corners[0]![0]) || 20
      const h = Math.abs(corners[1]![1] - corners[0]![1]) || 20
      view.center = [(corners[0]![0] + corners[1]![0]) / 2, (corners[0]![1] + corners[1]![1]) / 2]
      view.scale = Math.min(this.width / (w * 1.4), this.height / (h * 1.4))
    }
    this.applySketchView()
  }

  /** Recenters the 2D view on given sketch bounds (used by the sketcher's fit) */
  fitSketch(min: Vec2, max: Vec2): void {
    const view = this.view2d
    if (!view) return
    const w = Math.max(max[0] - min[0], 10)
    const h = Math.max(max[1] - min[1], 10)
    view.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]
    view.scale = Math.min(this.width / (w * 1.4), this.height / (h * 1.4))
    this.applySketchView()
  }

  private applySketchView(): void {
    const view = this.view2d
    if (!view) return
    view.width = this.width
    view.height = this.height
    const { y, normal } = view.frame
    const center = sketchToWorld(view.frame, view.center)
    this.ortho.position.copy(center).add(v3(normal).multiplyScalar(1000))
    this.ortho.up.copy(v3(y))
    this.ortho.lookAt(center)
    const halfW = this.width / 2 / view.scale
    const halfH = this.height / 2 / view.scale
    Object.assign(this.ortho, { left: -halfW, right: halfW, top: halfH, bottom: -halfH, near: 0.1, far: 20000 })
    this.ortho.updateProjectionMatrix()
    this.callbacks.onSketchView({ ...view, center: [...view.center] as Vec2 })
    this.requestRender()
  }

  private animateTo(position: THREE.Vector3, target: THREE.Vector3, up: readonly number[] = [0, 0, 1], done?: () => void): void {
    cancelAnimationFrame(this.animation)
    const fromPosition = this.camera.position.clone()
    const fromTarget = this.controls.target.clone()
    const fromUp = this.camera.up.clone()
    const toUp = v3(up)
    const started = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / CAMERA_ANIMATION_MS)
      const k = t * t * (3 - 2 * t)
      this.camera.position.lerpVectors(fromPosition, position, k)
      this.controls.target.lerpVectors(fromTarget, target, k)
      this.camera.up.lerpVectors(fromUp, toUp, k).normalize()
      this.camera.lookAt(this.controls.target)
      this.render()
      if (t < 1) {
        this.animation = requestAnimationFrame(step)
        return
      }
      this.camera.up.set(0, 0, 1)
      if (!this.view2d && this.controls.enabled) this.controls.update()
      done?.()
      this.requestRender()
    }
    this.animation = requestAnimationFrame(step)
  }

  // ---------------------------------------------------------------- input

  private onContextMenu = (event: Event) => event.preventDefault()

  private onWheel = (event: WheelEvent) => {
    const view = this.view2d
    if (!view) return
    event.preventDefault()
    // Zoom around the pointer: the sketch point under it stays put
    const rect = this.container.getBoundingClientRect()
    const sx = event.clientX - rect.left
    const sy = event.clientY - rect.top
    const before: Vec2 = [view.center[0] + (sx - this.width / 2) / view.scale, view.center[1] - (sy - this.height / 2) / view.scale]
    view.scale = Math.min(5000, Math.max(0.01, view.scale * Math.pow(1.0015, -event.deltaY)))
    view.center = [before[0] - (sx - this.width / 2) / view.scale, before[1] + (sy - this.height / 2) / view.scale]
    this.applySketchView()
  }

  private onPointerDown = (event: PointerEvent) => {
    // In the 2D view the left button belongs to the sketch tools
    const panning = this.view2d !== undefined && (event.button === 1 || event.button === 2)
    this.pressed = { x: event.clientX, y: event.clientY, button: event.button, panning }
    if (panning) this.input.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent) => {
    const pressed = this.pressed
    if (pressed?.panning && this.view2d) {
      const dx = event.clientX - pressed.x
      const dy = event.clientY - pressed.y
      pressed.x = event.clientX
      pressed.y = event.clientY
      this.view2d.center = [this.view2d.center[0] - dx / this.view2d.scale, this.view2d.center[1] + dy / this.view2d.scale]
      this.applySketchView()
      return
    }
    if (pressed || this.view2d) return
    if (this.jointPicking && !this.planePickResolve) {
      clearGroup(this.hover)
      const found = this.jointOriginAt(event)
      if (found) this.hover.add(found.highlight)
      this.input.style.cursor = found ? 'pointer' : ''
      this.requestRender()
    } else if (this.modifier && !this.planePickResolve) this.hoverModifier(event)
    else if (this.pickTargets.length) this.updateHover(event)
  }

  private onPointerUp = (event: PointerEvent) => {
    const pressed = this.pressed
    this.pressed = undefined
    if (!pressed || pressed.panning) return
    const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y)
    if (pressed.button !== 0 || moved > CLICK_TOLERANCE_PX || this.view2d) return
    if (this.jointPicking && !this.planePickResolve) {
      const found = this.jointOriginAt(event)
      if (found) this.callbacks.onJointOrigin(found.pick)
      return
    }
    if (this.modifier && !this.planePickResolve) {
      this.clickModifier(event)
      return
    }
    const result = this.pickAt(event)
    if (!result) return
    if (result.kind === 'plane' && this.planePickResolve) this.finishPlanePick(result.pick)
    else if (result.kind === 'region' && !this.planePickResolve) this.callbacks.onRegionClick(result.point)
  }

  private pickAt(event: PointerEvent): PickResult | undefined {
    const rect = this.container.getBoundingClientRect()
    const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(pointer, this.camera)
    // While picking a plane, regions do not count, and the other way round
    const targets = this.pickTargets.filter((t) => (this.planePickResolve ? t.object.userData.region === undefined : t.object.userData.region !== undefined))
    const hits = this.raycaster.intersectObjects(
      targets.map((t) => t.object),
      false,
    )
    for (const hit of hits) {
      const target = targets.find((t) => t.object === hit.object)
      const result = target?.resolve(hit)
      if (result) return result
    }
    return undefined
  }

  private updateHover(event: PointerEvent): void {
    clearGroup(this.hover)
    const result = this.pickAt(event)
    if (result) this.hover.add(result.highlight)
    this.input.style.cursor = result ? 'pointer' : ''
    this.requestRender()
  }

  // ------------------------------------------------------------- plumbing

  /** Size of the printer's build volume; the grid and frame are centred on the origin */
  setBed(size: Vec3): void {
    this.bed = size
    clearGroup(this.grid)
    this.buildGrid()
    this.requestRender()
  }

  /** Construction planes as translucent squares; the highlighted one stronger */
  setConstructionPlanes(planes: { index: number; frame: Frame; component: number }[], highlighted?: number): void {
    clearGroup(this.constructionPlanes)
    const size = 80
    for (const { index, frame, component } of planes) {
      const geometry = new THREE.PlaneGeometry(size, size)
      const strong = index === highlighted
      const quad = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: strong ? this.colors.highlight : this.colors.plane, transparent: true, opacity: strong ? 0.3 : 0.12, side: THREE.DoubleSide, depthWrite: false }),
      )
      quad.applyMatrix4(this.matrixOf(component).clone().multiply(planeMatrix(frame)))
      quad.userData.planeIndex = index
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: strong ? this.colors.highlight : this.colors.plane }))
      outline.applyMatrix4(this.matrixOf(component).clone().multiply(planeMatrix(frame)))
      this.constructionPlanes.add(quad, outline)
    }
    this.requestRender()
  }

  setAnalysisLayer(layer: AnalysisLayer): void {
    const old = this.analysisLayers.get(layer.id)
    if (old) {
      this.analysis.remove(old)
      old.geometry.dispose()
      ;(old.material as THREE.Material).dispose()
      this.analysisLayers.delete(layer.id)
    }
    if (layer.positions.length) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3))
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: layer.color,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
          // Drawn on the body surface, a little in front of it
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      )
      mesh.renderOrder = 4
      this.analysis.add(mesh)
      this.analysisLayers.set(layer.id, mesh)
    }
    this.requestRender()
  }

  private buildGrid(): void {
    const [bx, by, bz] = this.bed
    const lines = (step: number) => {
      const points: number[] = []
      for (let x = -bx / 2; x <= bx / 2 + 1e-6; x += step) points.push(x, -by / 2, 0, x, by / 2, 0)
      for (let y = -by / 2; y <= by / 2 + 1e-6; y += step) points.push(-bx / 2, y, 0, bx / 2, y, 0)
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
      return geometry
    }
    const minor = new THREE.LineSegments(lines(5), new THREE.LineBasicMaterial({ color: this.colors.gridMinor, transparent: true, opacity: 0.35 }))
    const major = new THREE.LineSegments(lines(10), new THREE.LineBasicMaterial({ color: this.colors.grid, transparent: true, opacity: 0.6 }))
    // The build volume as a frame
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bx, by, bz).translate(0, 0, bz / 2)),
      new THREE.LineBasicMaterial({ color: this.colors.grid, transparent: true, opacity: 0.25 }),
    )
    this.grid.add(minor, major, frame)
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container
    if (width === 0 || height === 0) return
    this.width = width
    this.height = height
    this.renderer.setSize(width, height, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    for (const material of this.lineMaterials) material.resolution.set(width, height)
    if (this.view2d) this.applySketchView()
    this.requestRender()
  }

  private render(): void {
    this.renderer.render(this.scene, this.view2d ? this.ortho : this.camera)
  }

  private requestRender(): void {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child)
    child.traverse((object) => {
      const disposable = object as THREE.Mesh
      // Highlights share the geometry of what they highlight; only dispose materials of those
      if (!object.userData.sharedGeometry) disposable.geometry?.dispose()
      const material = disposable.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
  }
}
