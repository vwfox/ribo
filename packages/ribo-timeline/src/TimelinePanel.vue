<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import type { EObject } from '@emfts/core'
import type { DocumentService } from 'ribo-contracts'
import { isSketch, type Feature, type Sketch } from 'ribo-model'
import { iconOf } from './icons'

const props = defineProps<{ document: DocumentService; editSketch: (sketch: Sketch) => void }>()

/** Re-read on every model change; the arrays are copies of the ELists */
const model = computed(() => {
  void props.document.revision.value
  const design = props.document.design.value
  const features = design.features.toArray()
  const rollback = design.rollback ?? -1
  return {
    parameters: design.parameters.toArray(),
    features,
    values: props.document.parameterValues(),
    /** Index the marker sits before; features from here on are rolled back */
    marker: rollback >= 0 ? rollback : features.length,
  }
})

const problemsByIndex = computed(() => {
  const map = new Map<number, string[]>()
  for (const problem of props.document.problems.value) {
    if (!map.has(problem.index)) map.set(problem.index, [])
    map.get(problem.index)!.push(problem.message)
  }
  return map
})

const designProblems = computed(() => problemsByIndex.value.get(-1) ?? [])

const isSelected = (object: EObject) => props.document.selection.value === object

const select = (object: EObject) => props.document.select(object)

function valueText(value: number | Error | undefined): string {
  if (value instanceof Error) return value.message
  if (value === undefined) return ''
  return `${Number(value.toFixed(3))}`
}

function toggleSuppressed(feature: Feature) {
  props.document.history.record('Unterdrücken', () => {
    feature.suppressed = !feature.suppressed
  })
}

function open(feature: Feature) {
  if (isSketch(feature)) props.editSketch(feature)
}

function detail(feature: Feature): string {
  if (!isSketch(feature)) return ''
  const curves = feature.curves.size()
  return curves ? `${curves} Kurven` : 'leer'
}
</script>

<template>
  <div class="ribo-browser">
    <div class="ribo-browser-header">
      <span>Parameter</span>
      <Button v-tooltip="'Parameter hinzufügen'" icon="pi pi-plus" size="small" text rounded @click="document.addParameter()" />
    </div>
    <ul class="ribo-browser-list">
      <li
        v-for="(parameter, i) in model.parameters"
        :key="i"
        :class="{ selected: isSelected(parameter), broken: model.values.get(parameter) instanceof Error }"
        @click="select(parameter)"
      >
        <i :class="iconOf(parameter)" />
        <span class="name">{{ parameter.name }}</span>
        <span class="value">{{ valueText(model.values.get(parameter)) }}</span>
      </li>
      <li v-if="model.parameters.length === 0" class="empty">Keine Parameter</li>
    </ul>

    <div class="ribo-browser-header">
      <span>Zeitleiste</span>
    </div>
    <ul class="ribo-browser-list">
      <template v-for="(feature, index) in model.features" :key="index">
        <li
          :class="{
            selected: isSelected(feature),
            suppressed: feature.suppressed,
            rolledBack: index >= model.marker,
            broken: problemsByIndex.has(index),
          }"
          :title="problemsByIndex.get(index)?.join('\n') ?? (isSketch(feature) ? 'Doppelklick bearbeitet die Skizze' : '')"
          @click="select(feature)"
          @dblclick="open(feature)"
        >
          <i :class="iconOf(feature)" />
          <span class="name">{{ feature.name }}</span>
          <span class="value">{{ detail(feature) }}</span>
          <i v-if="problemsByIndex.has(index)" class="pi pi-exclamation-triangle problem" />
          <Button
            v-if="isSketch(feature)"
            v-tooltip="'Skizze bearbeiten'"
            icon="pi pi-pencil"
            size="small"
            text
            rounded
            class="toggle"
            @click.stop="open(feature)"
          />
          <Button
            v-tooltip="'Zeitleiste bis hier zurückrollen'"
            icon="pi pi-step-backward-alt"
            size="small"
            text
            rounded
            class="toggle"
            @click.stop="document.setRollback(index + 1)"
          />
          <Button
            v-tooltip="feature.suppressed ? 'Aktivieren' : 'Unterdrücken'"
            :icon="feature.suppressed ? 'pi pi-eye-slash' : 'pi pi-eye'"
            size="small"
            text
            rounded
            class="toggle"
            @click.stop="toggleSuppressed(feature)"
          />
        </li>
        <li v-if="index + 1 === model.marker && model.marker < model.features.length" class="marker">
          <span>Zeitleisten-Marker</span>
          <Button label="Ans Ende" icon="pi pi-step-forward-alt" size="small" text @click="document.setRollback(-1)" />
        </li>
      </template>
      <li v-if="model.features.length === 0" class="empty">Noch keine Features – starte mit „Skizze erstellen“ (S).</li>
    </ul>

    <div v-for="message in designProblems" :key="message" class="ribo-browser-problem">
      <i class="pi pi-exclamation-triangle" /> {{ message }}
    </div>
  </div>
</template>

<style scoped>
.ribo-browser-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.25rem;
  font-weight: 600;
  font-size: 0.8rem;
}

.ribo-browser-list {
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
}

.ribo-browser-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.9rem;
  padding: 0 0.25rem 0 0.5rem;
  border-radius: 4px;
  cursor: pointer;
}

.ribo-browser-list li:hover {
  background: var(--p-content-hover-background);
}

.ribo-browser-list li.selected {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}

.ribo-browser-list li.suppressed .name {
  text-decoration: line-through;
  opacity: 0.6;
}

.ribo-browser-list li.rolledBack {
  opacity: 0.45;
}

.ribo-browser-list li.broken .name,
.ribo-browser-list .problem {
  color: var(--p-red-500);
}

.ribo-browser-list li.marker {
  cursor: default;
  justify-content: space-between;
  border-top: 2px solid var(--p-primary-color);
  border-radius: 0;
  font-size: 0.75rem;
  color: var(--p-primary-color);
}

.ribo-browser-list li.empty {
  color: var(--p-text-muted-color);
  cursor: default;
  font-size: 0.85rem;
}

.ribo-browser-list li.empty:hover,
.ribo-browser-list li.marker:hover {
  background: none;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value {
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
}

.toggle {
  opacity: 0;
}

li:hover .toggle,
li.selected .toggle {
  opacity: 0.8;
}

.ribo-browser-problem {
  color: var(--p-red-500);
  font-size: 0.85rem;
}
</style>
