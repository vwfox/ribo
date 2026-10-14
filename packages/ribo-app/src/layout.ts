/**
 * Workbench layout: where each panel sits, the sizes of the dock areas, and
 * floating panels. A panel's registered location is its default; moves are
 * kept as overrides in this browser's storage, so a reload keeps the layout.
 *
 * Modelled on gene's ui-layout (dock areas, drag & drop between them) and
 * board's floating windows (detach, move, resize, snap to an edge).
 */

import { reactive, ref, watch, type InjectionKey } from 'vue'
import type { PanelContribution, PanelLocation } from 'ribo-contracts'

export type DockArea = Exclude<PanelLocation, 'center'>

export interface FloatBox {
  x: number
  y: number
  w: number
  h: number
}

interface Placement {
  /** Docked area, or 'float' */
  area: DockArea | 'float'
  /** Where it was docked before it floated, to go back to */
  lastArea: DockArea
  float?: FloatBox
}

interface Stored {
  placements: Record<string, Placement>
  collapsed: string[]
  /** Active tab of the bottom area */
  bottomTab?: string
  sizes: { left: number; right: number; bottom: number }
}

const KEY = 'ribo.layout'
const SIZE_LIMITS = { left: [180, 600], right: [220, 600], bottom: [90, 600] } as const
const SNAP_PX = 24

function load(): Stored {
  const empty: Stored = { placements: {}, collapsed: [], sizes: { left: 300, right: 320, bottom: 150 } }
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null
    return { ...empty, ...(stored ?? {}), sizes: { ...empty.sizes, ...(stored?.sizes ?? {}) } }
  } catch {
    return empty
  }
}

export function createLayout() {
  const state = reactive<Stored>(load())
  watch(
    state,
    () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state))
      } catch {
        // Storage blocked: the layout holds for this session
      }
    },
    { deep: true },
  )

  /** The panel being dragged by its header, and the area it hovers over */
  const dragging = ref<string>()
  const dropTarget = ref<DockArea | 'float'>()

  const placementOf = (panel: PanelContribution): Placement => {
    const stored = state.placements[panel.id]
    if (stored) return stored
    const area = (panel.location === 'center' ? 'left' : panel.location) as DockArea
    return { area, lastArea: area }
  }

  const areaOf = (panel: PanelContribution): DockArea | 'float' | 'center' =>
    panel.location === 'center' ? 'center' : placementOf(panel).area

  function moveTo(panel: PanelContribution, area: DockArea | 'float', at?: { x: number; y: number }) {
    const current = placementOf(panel)
    const lastArea = current.area === 'float' ? current.lastArea : current.area
    const float = area === 'float' ? { x: at?.x ?? 120, y: at?.y ?? 80, w: current.float?.w ?? 320, h: current.float?.h ?? 360 } : current.float
    state.placements[panel.id] = { area, lastArea: area === 'float' ? lastArea : area, float }
    if (area === 'bottom') state.bottomTab = panel.id
    state.collapsed = state.collapsed.filter((id) => id !== panel.id)
  }

  function dock(panel: PanelContribution) {
    moveTo(panel, placementOf(panel).lastArea)
  }

  function setFloat(panel: PanelContribution, box: FloatBox) {
    const placement = placementOf(panel)
    state.placements[panel.id] = { ...placement, area: 'float', float: box }
  }

  /** Floating windows dragged to the left or right edge dock there */
  function snap(panel: PanelContribution, box: FloatBox, bounds: { width: number }) {
    if (box.x < SNAP_PX) moveTo(panel, 'left')
    else if (box.x + box.w > bounds.width - SNAP_PX) moveTo(panel, 'right')
  }

  function startDrag(id: string) {
    dragging.value = id
  }

  function endDrag() {
    dragging.value = undefined
    dropTarget.value = undefined
  }

  function setDropTarget(target: DockArea | 'float' | undefined) {
    dropTarget.value = target
  }

  function showTab(id: string) {
    state.bottomTab = id
  }

  function toggleCollapsed(id: string) {
    state.collapsed = state.collapsed.includes(id) ? state.collapsed.filter((c) => c !== id) : [...state.collapsed, id]
  }

  function resize(area: DockArea, size: number) {
    const [min, max] = SIZE_LIMITS[area]
    state.sizes[area] = Math.round(Math.min(max, Math.max(min, size)))
  }

  function reset() {
    state.placements = {}
    state.collapsed = []
  }

  return {
    state,
    dragging,
    dropTarget,
    placementOf,
    areaOf,
    moveTo,
    dock,
    setFloat,
    snap,
    startDrag,
    endDrag,
    setDropTarget,
    showTab,
    toggleCollapsed,
    resize,
    reset,
  }
}

export type Layout = ReturnType<typeof createLayout>

export const LAYOUT: InjectionKey<Layout> = Symbol('ribo.layout')
