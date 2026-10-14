<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import type { DocumentService } from 'ribo-contracts'
import { isSketch, type Feature, type Sketch } from 'ribo-model'
import { iconOf } from './icons'

const props = defineProps<{ document: DocumentService; editSketch: (sketch: Sketch) => void }>()

const root = ref<HTMLElement>()
/** Horizontal like Fusion's timeline when wide, a list when docked at a side */
const horizontal = ref(true)
let observer: ResizeObserver | undefined

onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) horizontal.value = entry.contentRect.width > entry.contentRect.height * 1.5
  })
  if (root.value) observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const model = computed(() => {
  void props.document.revision.value
  const design = props.document.design.value
  const features = design.features.toArray()
  const rollback = design.rollback ?? -1
  return { features, marker: rollback >= 0 ? rollback : features.length }
})

const problems = computed(() => {
  const map = new Map<number, string[]>()
  for (const problem of props.document.problems.value) {
    if (!map.has(problem.index)) map.set(problem.index, [])
    map.get(problem.index)!.push(problem.message)
  }
  return map
})

const isSelected = (feature: Feature) => props.document.selection.value === feature

function open(feature: Feature) {
  if (isSketch(feature)) props.editSketch(feature)
}

function toggleSuppressed(feature: Feature) {
  props.document.history.record('Unterdrücken', () => {
    feature.suppressed = !feature.suppressed
  })
}

const setMarker = (index: number) => props.document.setRollback(index >= model.value.features.length ? -1 : Math.max(0, index))

/** Dragging the marker: it lands in the gap nearest to the pointer */
function dragMarker(event: PointerEvent) {
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const strip = root.value?.querySelector('.ribo-timeline-strip')
  const move = (e: PointerEvent) => {
    const items = [...(strip?.querySelectorAll<HTMLElement>('.ribo-timeline-item') ?? [])]
    let index = items.length
    for (let i = 0; i < items.length; i++) {
      const rect = items[i]!.getBoundingClientRect()
      const middle = horizontal.value ? rect.left + rect.width / 2 : rect.top + rect.height / 2
      if ((horizontal.value ? e.clientX : e.clientY) < middle) {
        index = i
        break
      }
    }
    if (index !== model.value.marker) setMarker(index)
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

function titleOf(feature: Feature, index: number) {
  const issue = problems.value.get(index)?.join('\n')
  return [feature.name, issue, isSketch(feature) ? 'Doppelklick: Skizze bearbeiten' : ''].filter(Boolean).join('\n')
}
</script>

<template>
  <div ref="root" class="ribo-timeline" :class="horizontal ? 'horizontal' : 'vertical'" :data-revision="document.revision.value">
    <div class="ribo-timeline-controls">
      <Button v-tooltip="'Zum Anfang'" icon="pi pi-step-backward-alt" size="small" text rounded @click="setMarker(0)" />
      <Button v-tooltip="'Ein Schritt zurück'" icon="pi pi-caret-left" size="small" text rounded @click="setMarker(model.marker - 1)" />
      <Button v-tooltip="'Ein Schritt vor'" icon="pi pi-caret-right" size="small" text rounded @click="setMarker(model.marker + 1)" />
      <Button v-tooltip="'Zum Ende'" icon="pi pi-step-forward-alt" size="small" text rounded @click="setMarker(model.features.length)" />
    </div>

    <div class="ribo-timeline-strip">
      <template v-for="(feature, index) in model.features" :key="index">
        <div v-if="index === model.marker" class="ribo-timeline-marker" title="Zeitleisten-Marker ziehen" @pointerdown="dragMarker" />
        <div
          class="ribo-timeline-item"
          :class="{
            selected: isSelected(feature),
            suppressed: feature.suppressed,
            rolledBack: index >= model.marker,
            broken: problems.has(index),
          }"
          :title="titleOf(feature, index)"
          @click="document.select(feature)"
          @dblclick="open(feature)"
        >
          <i :class="iconOf(feature)" />
          <span v-if="!horizontal" class="name">{{ feature.name }}</span>
          <i v-if="problems.has(index)" class="pi pi-exclamation-triangle problem" />
          <Button
            v-if="!horizontal"
            v-tooltip="feature.suppressed ? 'Aktivieren' : 'Unterdrücken'"
            :icon="feature.suppressed ? 'pi pi-eye-slash' : 'pi pi-eye'"
            size="small"
            text
            rounded
            class="toggle"
            @click.stop="toggleSuppressed(feature)"
          />
        </div>
      </template>
      <div v-if="model.marker >= model.features.length" class="ribo-timeline-marker" title="Zeitleisten-Marker ziehen" @pointerdown="dragMarker" />
      <span v-if="model.features.length === 0" class="ribo-timeline-empty">Noch keine Features – starte mit „Skizze erstellen“ (S).</span>
    </div>
  </div>
</template>

<style scoped>
.ribo-timeline {
  display: flex;
  gap: 0.5rem;
  height: 100%;
}

.ribo-timeline.horizontal {
  align-items: center;
}

.ribo-timeline.vertical {
  flex-direction: column;
}

.ribo-timeline-controls {
  display: flex;
  flex: none;
}

.ribo-timeline-strip {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: auto;
  padding: 4px 2px;
}

.vertical .ribo-timeline-strip {
  flex-direction: column;
  align-items: stretch;
}

.ribo-timeline-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  flex: none;
  min-width: 2.1rem;
  height: 2.1rem;
  padding: 0 0.4rem;
  border-radius: 5px;
  border: 1px solid var(--p-content-border-color);
  cursor: pointer;
  user-select: none;
}

.vertical .ribo-timeline-item {
  justify-content: flex-start;
  height: 1.9rem;
  border-color: transparent;
}

.ribo-timeline-item:hover {
  background: var(--p-content-hover-background);
}

.ribo-timeline-item.selected {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  border-color: var(--p-primary-color);
}

.ribo-timeline-item.suppressed {
  opacity: 0.45;
  text-decoration: line-through;
}

.ribo-timeline-item.rolledBack {
  opacity: 0.35;
}

.ribo-timeline-item.broken,
.ribo-timeline-item .problem {
  color: var(--p-red-500);
}

.ribo-timeline-item.broken {
  border-color: var(--p-red-500);
}

.ribo-timeline-item .name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ribo-timeline-item .toggle {
  opacity: 0;
}

.ribo-timeline-item:hover .toggle {
  opacity: 0.8;
}

.ribo-timeline-marker {
  flex: none;
  align-self: stretch;
  width: 6px;
  border-radius: 3px;
  background: var(--p-primary-color);
  cursor: ew-resize;
  touch-action: none;
}

.vertical .ribo-timeline-marker {
  width: auto;
  height: 6px;
  cursor: ns-resize;
}

.ribo-timeline-empty {
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  padding: 0 0.5rem;
}
</style>
