<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import SelectButton from 'primevue/selectbutton'
import type { BodyMesh, DocumentService, Vec3 } from 'ribo-contracts'
import { IDENTITY, applyDirection, applyPoint, decompose, frameToWorld } from 'ribo-geometry'
import { isBodyModifier, isEdgeFeature, isExtrude, isHole, isJoint, isFillet, isProfileFeature, isShell, isSketch, sketchOf, type EdgeFeature, type ProfileFeature, type Shell } from 'ribo-model'
import { SceneView, type SceneColors, type ViewDirection } from './SceneView'
import type { ViewportController } from './ViewportController'

const props = defineProps<{ document: DocumentService; controller: ViewportController }>()

const root = ref<HTMLElement>()
const container = ref<HTMLElement>()
let scene: SceneView | undefined
let colorScheme: MediaQueryList | undefined

const sketchMode = computed(() => props.controller.mode.value === 'sketch')

const status = computed(() => {
  const document = props.document
  if (document.building.value) return 'Berechne …'
  const result = document.result.value
  if (!result) return 'Kernel wird geladen …'
  const volume = result.bodies.reduce((sum, body) => sum + body.volume, 0)
  const volumeText = volume >= 1000 ? `${(volume / 1000).toFixed(2)} cm³` : `${volume.toFixed(0)} mm³`
  return `${result.bodies.length} Körper · ${volumeText} · ${result.duration.toFixed(0)} ms`
})
const problemCount = computed(() => props.document.problems.value.length)

function colors(): SceneColors {
  const dark = document.documentElement.classList.contains('dark-theme')
  return dark
    ? {
        body: '#5eead4',
        edge: '#0f172a',
        sketch: '#60a5fa',
        construction: '#fb923c',
        highlight: '#f59e0b',
        region: '#60a5fa',
        regionPicked: '#3b82f6',
        plane: '#a78bfa',
        grid: '#475569',
        gridMinor: '#334155',
      }
    : {
        body: '#14b8a6',
        edge: '#134e4a',
        sketch: '#2563eb',
        construction: '#ea580c',
        highlight: '#ea580c',
        region: '#60a5fa',
        regionPicked: '#2563eb',
        plane: '#7c3aed',
        grid: '#94a3b8',
        gridMinor: '#cbd5e1',
      }
}

/** The profile feature whose regions are offered for picking */
const profileFeature = computed<ProfileFeature | undefined>(() => {
  const selected = props.document.selection.value
  return !sketchMode.value && isProfileFeature(selected) && selected.sketch ? selected : undefined
})

/** The fillet, chamfer or shell whose edges or faces are offered for picking */
const modifierFeature = computed<EdgeFeature | Shell | undefined>(() => {
  const selected = props.document.selection.value
  return !sketchMode.value && isBodyModifier(selected) ? selected : undefined
})

/** The joint whose origins are being picked */
const jointFeature = computed(() => {
  void props.document.revision.value
  const selected = props.document.selection.value
  return !sketchMode.value && isJoint(selected) && (!selected.first || !selected.second) ? selected : undefined
})

const modifierBanner = computed(() => {
  if (dragDistance.value !== undefined) return `Abstand: ${dragDistance.value} mm`
  const joint = jointFeature.value
  if (joint) return joint.first ? 'Bezug 2 am Bauteil anklicken, das sich bewegt: Fläche, Kreiskante oder Kante' : 'Bezug 1 am stehenden Bauteil anklicken: Fläche, Kreiskante oder Kante'
  const feature = modifierFeature.value
  if (!feature) return undefined
  if (isShell(feature)) return 'Flächen anklicken, die offen bleiben sollen · erneuter Klick entfernt sie'
  return `Kanten zum ${isFillet(feature) ? 'Abrunden' : 'Fasen'} anklicken · erneuter Klick entfernt sie`
})

/** Bodies of components the user has not hidden */
const shownBodies = (result: { bodies: BodyMesh[] } | undefined) =>
  (result?.bodies ?? []).filter((b) =>
    b.component === 0 ? props.document.design.value.visible !== false : props.document.componentAt(b.component)?.visible !== false,
  )

function updateBodies() {
  if (!scene) return
  const hadBodies = scene.hasBodies()
  const design = props.document.design.value
  scene.setPlacements(props.document.placements.value, props.document.componentIndexOf(design.activeComponent))
  // The result is shown, also while editing a fillet; its edges are picked on the bodies before it
  scene.setBodies(shownBodies(props.document.result.value))
  scene.setPickBodies(modifierFeature.value ? shownBodies(props.document.inputResult.value) : undefined)
  scene.setJointPicking(jointFeature.value !== undefined)
  updateJointMarkers()
  if (!hadBodies && scene.hasBodies() && !sketchMode.value) scene.view('iso')
  updateModifier()
}

function updateModifier() {
  if (!scene) return
  const feature = modifierFeature.value
  if (!feature) {
    scene.setModifierPicking(undefined)
    return
  }
  if (isEdgeFeature(feature)) {
    scene.setModifierPicking({ mode: 'edges', picks: feature.edges.toArray().map((e) => [e.x, e.y, e.z]) })
  } else {
    scene.setModifierPicking({ mode: 'faces', picks: feature.faces.toArray().map((f) => [f.x, f.y, f.z]) })
  }
}

function updateSketches() {
  if (!scene) return
  const document = props.document
  const plan = document.plan.value
  if (sketchMode.value) {
    // The sketch editor draws the open sketch itself
    scene.setSketches(plan, new Set())
    return
  }
  const features = document.design.value.features.toArray()
  const consumed = new Set(plan.features.flatMap((f) => (f.kind === 'extrude' || f.kind === 'revolve' || f.kind === 'hole' ? [f.sketch] : [])))
  const visible = new Set(plan.features.flatMap((f) => (f.kind === 'sketch' && !consumed.has(f.index) ? [f.index] : [])))
  const selected = document.selection.value
  const selectedSketch = sketchOf(selected) ?? (isHole(selected) ? selected.sketch : undefined)
  const feature = profileFeature.value
  const highlighted = selectedSketch ? features.indexOf(selectedSketch) : undefined
  if (highlighted !== undefined && highlighted >= 0) visible.add(highlighted)
  if (feature?.sketch) visible.add(features.indexOf(feature.sketch))
  scene.setSketches(plan, visible, isSketch(document.selection.value) ? highlighted : undefined)
}

function updateJointMarkers() {
  if (!scene) return
  const selected = props.document.selection.value
  const markers = []
  if (isJoint(selected)) {
    for (const origin of [selected.first, selected.second]) {
      if (!origin) continue
      markers.push({
        origin: [origin.originX, origin.originY, origin.originZ] as Vec3,
        z: [origin.zX, origin.zY, origin.zZ] as Vec3,
        x: [origin.xX, origin.xY, origin.xZ] as Vec3,
        component: props.document.componentIndexOf(origin.component),
      })
    }
  }
  scene.setJointMarkers(markers)
}

/** Live value while the extrude handle is dragged */
const dragDistance = ref<number>()

/** Where the extrude arrow sits: over the middle of its profiles, at the end of the extrusion */
function updateHandle() {
  if (!scene) return
  const feature = profileFeature.value
  if (!isExtrude(feature) || !feature.sketch || dragDistance.value !== undefined) {
    if (!isExtrude(feature)) scene.setHandle(undefined)
    return
  }
  const document = props.document
  const index = document.design.value.features.indexOf(feature)
  const planned = document.plan.value.features.find((f) => f.index === index)
  const sketch = document.sketchPlan(feature.sketch)
  if (planned?.kind !== 'extrude' || !sketch || planned.profiles.length === 0) {
    scene.setHandle(undefined)
    return
  }
  // Centre of the picked profiles' inner points
  const points = planned.profiles.map((i) => sketch.regions[i]?.inside).filter((p): p is [number, number] => !!p)
  const centre: [number, number] = [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
  const placement = document.placements.value[planned.component] ?? IDENTITY
  const base = applyPoint(placement, frameToWorld(sketch.frame, centre))
  const normal = applyDirection(placement, sketch.frame.normal)
  const direction: Vec3 = planned.direction === 'Reversed' ? [-normal[0], -normal[1], -normal[2]] : normal
  const position = planned.direction === 'Symmetric' ? planned.distance / 2 : planned.distance
  lastHandle = { base, direction }
  scene.setHandle({ base, direction, position })
}

function onHandleDrag(position: number, phase: 'start' | 'move' | 'end') {
  const feature = profileFeature.value
  if (!isExtrude(feature)) return
  if (phase === 'start') {
    props.document.history.begin('Extrusion ziehen')
    return
  }
  if (phase === 'end') {
    dragDistance.value = undefined
    props.document.history.end()
    updateHandle()
    return
  }
  // A tenth of a millimetre, never zero or below
  const along = feature.direction === 'Symmetric' ? position * 2 : position
  const distance = Math.max(0.1, Math.round(along * 10) / 10)
  dragDistance.value = distance
  feature.distance = String(distance)
  scene?.setHandle({ ...currentHandle(), position: feature.direction === 'Symmetric' ? distance / 2 : distance })
}

/** The handle as last placed, to move it along while dragging */
let lastHandle: { base: Vec3; direction: Vec3 } | undefined
function currentHandle() {
  return lastHandle ?? { base: [0, 0, 0] as Vec3, direction: [0, 0, 1] as Vec3 }
}

function updatePlanes() {
  if (!scene) return
  const features = props.document.design.value.features.toArray()
  const selected = props.document.selection.value
  const planes = props.document.plan.value.features.flatMap((f) => (f.kind === 'plane' ? [{ index: f.index, frame: f.frame, component: f.component }] : []))
  scene.setConstructionPlanes(planes, selected ? features.indexOf(selected as never) : undefined)
}

function updateRegions() {
  if (!scene) return
  const feature = profileFeature.value
  const planned = feature?.sketch ? props.document.sketchPlan(feature.sketch) : undefined
  if (!feature || !planned) {
    scene.setProfileRegions(undefined, new Set())
    return
  }
  const index = props.document.design.value.features.indexOf(feature)
  const planFeature = props.document.plan.value.features.find((f) => f.index === index)
  const picked = new Set(planFeature && (planFeature.kind === 'extrude' || planFeature.kind === 'revolve') ? planFeature.profiles : [])
  scene.setProfileRegions(planned, picked)
}

function view(direction: ViewDirection) {
  scene?.view(direction)
}

/** The component being moved, unless a relation decides where it sits */
const movingComponent = computed(() => {
  void props.document.revision.value
  const component = props.controller.moving.value
  if (!component || sketchMode.value || !props.document.design.value.components.contains(component)) return undefined
  return component
})

/**
 * Why the gizmo would be overruled, if it would: a joint places the component,
 * or alignments leave it no freedom. Alignments that leave some let it move within that.
 */
const movingHeld = computed(() => {
  const component = movingComponent.value
  if (!component || component.grounded) return undefined
  const joined = props.document.design.value.features
    .toArray()
    .some((f) => isJoint(f) && (f.kind ?? 'Rigid') !== 'Rigid' && !f.suppressed && f.first && f.second && (f.first.component === component || f.second.component === component))
  if (joined) return 'wird von einem Gelenk platziert – zum freien Bewegen das Gelenk unterdrücken'
  if (props.document.freedom.value[props.document.componentIndexOf(component)] === 0) return 'ist durch Ausrichtungen vollständig bestimmt'
  return undefined
})

const MOVE_MODES = [
  { label: 'Verschieben', value: 'translate' },
  { label: 'Drehen', value: 'rotate' },
]

const setMoveMode = (mode: 'translate' | 'rotate') => {
  props.controller.setMoveMode(mode)
}

const round = (value: number) => String(Math.round(value * 100) / 100)

function onComponentMove(placement: number[], phase: 'start' | 'move' | 'end') {
  const component = movingComponent.value
  if (!component) return
  if (phase === 'start') props.document.history.begin('Bauteil bewegen')
  // Held by alignments, it ends where they let it slide - that becomes its own placement, not the pointer's
  const index = props.document.componentIndexOf(component)
  const solved = phase === 'end' && props.document.freedom.value[index] !== undefined ? props.document.placements.value[index] : undefined
  const { position, rotation } = decompose(solved ?? placement)
  ;[component.positionX, component.positionY, component.positionZ] = position.map(round) as [string, string, string]
  if (solved || props.controller.moveMode.value === 'rotate') [component.rotationX, component.rotationY, component.rotationZ] = rotation.map(round) as [string, string, string]
  if (phase === 'end') props.document.history.end()
}

function updateMoving() {
  if (!scene) return
  const component = movingComponent.value
  scene.setMoving(component && !movingHeld.value ? props.document.componentIndexOf(component) : undefined, props.controller.moveMode.value)
}

/** A feature whose step is open in the viewport: picking profiles, edges or faces */
const openStep = computed(() => profileFeature.value ?? modifierFeature.value ?? jointFeature.value ?? movingComponent.value)

/** Closes the open step; its changes are already applied */
function applyStep() {
  if (movingComponent.value) props.controller.moveComponent(undefined)
  else props.document.select(undefined)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.controller.picking.value) props.controller.cancelPick()
  else if (event.key === 'Escape' && movingComponent.value) props.controller.moveComponent(undefined)
  const target = event.target as HTMLElement | null
  if (event.key === 'Enter' && openStep.value && !target?.closest('input, textarea, select, [contenteditable="true"]')) {
    event.preventDefault()
    applyStep()
  }
}

const onColorScheme = () => scene?.setColors(colors())

onMounted(() => {
  scene = new SceneView(container.value!, root.value!, colors(), {
    onSketchView: (sketchView) => props.controller.setSketchView(sketchView),
    onRegionClick: (point) => {
      const feature = profileFeature.value
      if (feature) props.document.toggleProfile(feature, point)
    },
    onEdgeClick: (midpoint, existing) => {
      const feature = modifierFeature.value
      if (isEdgeFeature(feature)) props.document.toggleEdge(feature, midpoint, existing)
    },
    onFaceClick: (point, existing) => {
      const feature = modifierFeature.value
      if (isShell(feature)) props.document.toggleFace(feature, point, existing)
    },
    onHandleDrag,
    onComponentMove,
    onJointOrigin: (pick) => {
      const joint = jointFeature.value
      if (joint) props.document.setJointOrigin(joint, joint.first ? 'second' : 'first', pick.component, pick.origin, pick.z, pick.x, pick.kind)
    },
  })
  scene.view('iso')
  props.controller.attach(scene)
  colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', onColorScheme)
  window.addEventListener('keydown', onKeyDown)

  watch(
    [() => props.document.result.value, () => props.document.inputResult.value, () => props.document.placements.value, () => props.document.revision.value, modifierFeature, jointFeature],
    updateBodies,
    { immediate: true },
  )
  watch([movingComponent, movingHeld, () => props.controller.moveMode.value, () => props.document.result.value], updateMoving, { immediate: true })
  watch(
    () => props.document.revision.value,
    () => {
      updateModifier()
      updateJointMarkers()
    },
  )
  watch(
    [() => props.document.plan.value, () => props.document.selection.value, () => props.document.placements.value, sketchMode],
    () => {
      updateSketches()
      updateRegions()
      updatePlanes()
      updateHandle()
    },
    { immediate: true },
  )
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  colorScheme?.removeEventListener('change', onColorScheme)
  props.controller.detach()
  scene?.dispose()
  scene = undefined
})
</script>

<template>
  <div ref="root" class="ribo-viewport">
    <div ref="container" class="ribo-viewport-canvas" />
    <component :is="overlay" v-for="(overlay, i) in controller.overlays" :key="i" />

    <div v-if="controller.picking.value" class="ribo-viewport-banner">
      <i class="pi pi-hand-pointer" /> Ebene oder ebene Fläche für die Skizze wählen · <kbd>Esc</kbd> bricht ab
    </div>
    <div v-else-if="movingComponent" class="ribo-viewport-banner subtle step">
      <span v-if="movingHeld">{{ movingComponent.name }} {{ movingHeld }}</span>
      <template v-else>
        <span>{{ movingComponent.name }} bewegen: Griffe ziehen{{ document.freedom.value[document.componentIndexOf(movingComponent)] ? ' – Ausrichtungen halten es, es gleitet nur in ihren freien Richtungen' : '' }}</span>
        <SelectButton
          :model-value="controller.moveMode.value"
          :options="MOVE_MODES"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          @update:model-value="setMoveMode"
        />
      </template>
      <Button label="OK" icon="pi pi-check" severity="success" size="small" @click="applyStep" />
    </div>
    <div v-else-if="openStep" class="ribo-viewport-banner subtle step">
      <span>{{ modifierBanner ?? (isExtrude(profileFeature) ? 'Profile anklicken · Pfeil ziehen ändert den Abstand' : 'Profile anklicken, um sie hinzuzufügen oder zu entfernen') }}</span>
      <Button label="OK" icon="pi pi-check" severity="success" size="small" @click="applyStep" />
    </div>

    <div v-if="!sketchMode" class="ribo-viewport-views">
      <Button v-tooltip.left="'Alles zeigen'" icon="pi pi-expand" severity="secondary" size="small" text @click="view('iso')" />
      <Button v-tooltip.left="'Oben'" label="O" severity="secondary" size="small" text @click="view('top')" />
      <Button v-tooltip.left="'Vorne'" label="V" severity="secondary" size="small" text @click="view('front')" />
      <Button v-tooltip.left="'Rechts'" label="R" severity="secondary" size="small" text @click="view('right')" />
    </div>
    <div class="ribo-viewport-status">
      <span>{{ status }}</span>
      <span v-if="problemCount" class="ribo-viewport-problems">
        <i class="pi pi-exclamation-triangle" /> {{ problemCount }} {{ problemCount === 1 ? 'Problem' : 'Probleme' }}
      </span>
      <span v-if="!sketchMode" class="ribo-viewport-hint">Links: drehen · Rechts/Mitte: verschieben · Rad: zoomen</span>
      <span v-else class="ribo-viewport-hint">Rechts/Mitte: verschieben · Rad: zoomen</span>
    </div>
  </div>
</template>

<style scoped>
.ribo-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 40%, var(--p-surface-50), var(--p-surface-200));
}

.ribo-viewport-canvas {
  position: absolute;
  inset: 0;
}

.ribo-viewport-banner {
  position: absolute;
  top: 0.75rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color);
  font-size: 0.85rem;
  pointer-events: none;
  white-space: nowrap;
}

.ribo-viewport-banner.step {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.25rem 0.3rem 0.25rem 0.9rem;
  pointer-events: auto;
}

.ribo-viewport-banner.subtle {
  background: color-mix(in srgb, var(--p-content-background) 85%, transparent);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
}

kbd {
  font-family: inherit;
  padding: 0 0.3rem;
  border-radius: 3px;
  border: 1px solid currentColor;
}

.ribo-viewport-views {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  padding: 0.125rem;
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-content-background) 85%, transparent);
  border: 1px solid var(--p-content-border-color);
}

.ribo-viewport-status {
  position: absolute;
  left: 0.75rem;
  bottom: 0.5rem;
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  pointer-events: none;
}

.ribo-viewport-problems {
  color: var(--p-red-500);
}

.ribo-viewport-hint {
  opacity: 0.7;
}
</style>

<style>
/* Unscoped: in a scoped block Vue keeps only the :global() part of a selector */
html.dark-theme .ribo-viewport {
  background: radial-gradient(circle at 50% 40%, var(--p-surface-800), var(--p-surface-950));
}
</style>
