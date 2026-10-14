<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import type { DocumentService } from 'ribo-contracts'
import { isProfileFeature, isSketch, sketchOf, type ProfileFeature } from 'ribo-model'
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
  const consumed = new Set(plan.features.flatMap((f) => (f.kind === 'sketch' ? [] : [f.sketch])))
  const visible = new Set(plan.features.flatMap((f) => (f.kind === 'sketch' && !consumed.has(f.index) ? [f.index] : [])))
  const selectedSketch = sketchOf(document.selection.value)
  const feature = profileFeature.value
  const highlighted = selectedSketch ? features.indexOf(selectedSketch) : undefined
  if (highlighted !== undefined && highlighted >= 0) visible.add(highlighted)
  if (feature?.sketch) visible.add(features.indexOf(feature.sketch))
  scene.setSketches(plan, visible, isSketch(document.selection.value) ? highlighted : undefined)
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
  const planFeature = props.document.plan.value.features.find((f) => f.kind !== 'sketch' && f.index === index)
  const picked = new Set(planFeature && planFeature.kind !== 'sketch' ? planFeature.profiles : [])
  scene.setProfileRegions(planned, picked)
}

function view(direction: ViewDirection) {
  scene?.view(direction)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.controller.picking.value) props.controller.cancelPick()
}

const onColorScheme = () => scene?.setColors(colors())

onMounted(() => {
  scene = new SceneView(container.value!, root.value!, colors(), {
    onSketchView: (sketchView) => props.controller.setSketchView(sketchView),
    onRegionClick: (point) => {
      const feature = profileFeature.value
      if (feature) props.document.toggleProfile(feature, point)
    },
  })
  scene.view('iso')
  props.controller.attach(scene)
  colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', onColorScheme)
  window.addEventListener('keydown', onKeyDown)

  watch(
    () => props.document.result.value,
    (result) => {
      const hadBodies = scene!.hasBodies()
      scene!.setBodies(result?.bodies ?? [])
      if (!hadBodies && scene!.hasBodies() && !sketchMode.value) scene!.view('iso')
    },
    { immediate: true },
  )
  watch(
    [() => props.document.plan.value, () => props.document.selection.value, sketchMode],
    () => {
      updateSketches()
      updateRegions()
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
    <div v-else-if="profileFeature" class="ribo-viewport-banner subtle">Profile anklicken, um sie hinzuzufügen oder zu entfernen</div>

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
