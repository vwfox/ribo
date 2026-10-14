<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import type { BodyMesh, DocumentService, Vec3 } from 'ribo-contracts'
import { isBodyModifier, isEdgeFeature, isHole, isJoint, isFillet, isProfileFeature, isShell, isSketch, sketchOf, type EdgeFeature, type ProfileFeature, type Shell } from 'ribo-model'
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
  const joint = jointFeature.value
  if (joint) return joint.first ? 'Ursprung am zweiten Bauteil anklicken: Kreiskante oder ebene Fläche' : 'Ursprung am ersten Bauteil anklicken: Kreiskante oder ebene Fläche'
  const feature = modifierFeature.value
  if (!feature) return undefined
  if (isShell(feature)) return 'Flächen anklicken, die offen bleiben sollen · erneuter Klick entfernt sie'
  return `Kanten zum ${isFillet(feature) ? 'Abrunden' : 'Fasen'} anklicken · erneuter Klick entfernt sie`
})

/** Bodies of components the user has not hidden */
const shownBodies = (result: { bodies: BodyMesh[] } | undefined) =>
  (result?.bodies ?? []).filter((b) => props.document.componentAt(b.component)?.visible !== false)

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

/** A feature whose step is open in the viewport: picking profiles, edges or faces */
const openStep = computed(() => profileFeature.value ?? modifierFeature.value ?? jointFeature.value)

/** Closes the open step; its changes are already applied */
function applyStep() {
  props.document.select(undefined)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.controller.picking.value) props.controller.cancelPick()
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
    onJointOrigin: (pick) => {
      const joint = jointFeature.value
      if (joint) props.document.setJointOrigin(joint, joint.first ? 'second' : 'first', pick.component, pick.origin, pick.z, pick.x)
    },
  })
  scene.view('iso')
  props.controller.attach(scene)
  colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', onColorScheme)
  window.addEventListener('keydown', onKeyDown)

  watch(
    [() => props.document.result.value, () => props.document.inputResult.value, () => props.document.placements.value, modifierFeature, jointFeature],
    updateBodies,
    { immediate: true },
  )
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
    <div v-else-if="openStep" class="ribo-viewport-banner subtle step">
      <span>{{ modifierBanner ?? 'Profile anklicken, um sie hinzuzufügen oder zu entfernen' }}</span>
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
