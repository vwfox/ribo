import { markRaw, ref, shallowReactive, shallowRef, type Component } from 'vue'
import type { PlanePick, PlanPlane, SketchView, ViewportService } from 'ribo-contracts'
import type { SceneView } from './SceneView'

/**
 * The viewport service. The scene only exists while the viewport is mounted;
 * requests made before that are remembered and applied when it attaches.
 */
export class ViewportController implements ViewportService {
  readonly mode = ref<'model' | 'sketch'>('model')
  readonly sketchView = shallowRef<SketchView | undefined>()
  readonly overlays = shallowReactive<Component[]>([])
  readonly picking = ref(false)
  private scene: SceneView | undefined
  private pendingSketch: { plane: PlanPlane; offset: number } | undefined

  attach(scene: SceneView): void {
    this.scene = scene
    if (this.pendingSketch) scene.enterSketchView(this.pendingSketch.plane, this.pendingSketch.offset)
  }

  /** The scene reports its 2D view here */
  setSketchView(view: SketchView | undefined): void {
    this.sketchView.value = view
  }

  detach(): void {
    this.scene = undefined
    this.sketchView.value = undefined
  }

  enterSketchView(plane: PlanPlane, offset: number): void {
    this.mode.value = 'sketch'
    this.pendingSketch = { plane, offset }
    this.scene?.enterSketchView(plane, offset)
  }

  exitSketchView(): void {
    this.mode.value = 'model'
    this.pendingSketch = undefined
    this.scene?.exitSketchView()
  }

  async pickPlane(): Promise<PlanePick | undefined> {
    if (!this.scene) return undefined
    this.picking.value = true
    try {
      return await this.scene.pickPlane()
    } finally {
      this.picking.value = false
    }
  }

  cancelPick(): void {
    this.scene?.cancelPick()
  }

  registerOverlay(component: Component): () => void {
    const entry = markRaw(component)
    this.overlays.push(entry)
    return () => {
      const index = this.overlays.indexOf(entry)
      if (index >= 0) this.overlays.splice(index, 1)
    }
  }
}
