<script setup lang="ts">
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import type { DocumentService } from 'ribo-contracts'
import { isDimension, isGeometricConstraint, isSketchCurve, isSketchPoint, type Dimension } from 'ribo-model'
import type { SketcherController } from './SketcherController'

const props = defineProps<{ controller: SketcherController; document: DocumentService }>()
const controller = props.controller

const sketch = computed(() => controller.active.value)

const counts = computed(() => {
  void props.document.revision.value
  const s = sketch.value
  if (!s) return undefined
  const constraints = s.constraints.toArray()
  return {
    curves: s.curves.size(),
    constraints: constraints.filter(isGeometricConstraint).length,
    dimensions: constraints.filter(isDimension).length,
    profiles: props.document.sketchPlan(s)?.regions.length ?? 0,
  }
})

const selected = computed(() => [...controller.selection.value])
const singleDimension = computed(() => {
  void props.document.revision.value
  const [only] = selected.value
  return selected.value.length === 1 && isDimension(only) ? (only as Dimension) : undefined
})
const selectedCurves = computed(() => selected.value.filter(isSketchCurve))
const selectionText = computed(() => {
  const points = selected.value.filter(isSketchPoint).length
  const curves = selectedCurves.value.length
  const other = selected.value.length - points - curves
  const parts = [curves && `${curves} Kurve${curves === 1 ? '' : 'n'}`, points && `${points} Punkt${points === 1 ? '' : 'e'}`, other && `${other} Abhängigkeit${other === 1 ? '' : 'en'}`]
  return parts.filter(Boolean).join(', ')
})

const OPTIONS = [
  { key: 'grid', label: 'Raster' },
  { key: 'snapToGrid', label: 'Am Raster fangen' },
  { key: 'profiles', label: 'Profile anzeigen' },
  { key: 'dimensions', label: 'Bemaßungen anzeigen' },
  { key: 'constraints', label: 'Abhängigkeiten anzeigen' },
] as const

function setDimension(value: string | undefined) {
  const dimension = singleDimension.value
  if (dimension && value !== undefined) controller.commitDimension(dimension, value)
}
</script>

<template>
  <div v-if="sketch" class="ribo-palette">
    <div class="ribo-palette-name">
      <i class="pi pi-pencil" /> <strong>{{ sketch.name }}</strong> · Ebene {{ sketch.plane }}
    </div>
    <div v-if="counts" class="ribo-palette-counts">
      {{ counts.curves }} Kurven · {{ counts.constraints }} Abhängigkeiten · {{ counts.dimensions }} Bemaßungen ·
      {{ counts.profiles }} {{ counts.profiles === 1 ? 'Profil' : 'Profile' }}
    </div>

    <div class="ribo-palette-section">Optionen</div>
    <label v-for="option in OPTIONS" :key="option.key" class="ribo-palette-option">
      <ToggleSwitch v-model="controller.options.value[option.key]" />
      <span>{{ option.label }}</span>
    </label>

    <template v-if="selected.length">
      <div class="ribo-palette-section">Auswahl</div>
      <div class="ribo-palette-counts">{{ selectionText }}</div>
      <label v-if="singleDimension" class="ribo-palette-field">
        <span>Wert der Bemaßung (Ausdruck)</span>
        <InputText
          :model-value="singleDimension.expression"
          size="small"
          fluid
          spellcheck="false"
          @change="setDimension(($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="ribo-palette-buttons">
        <Button
          v-if="selectedCurves.length"
          label="Hilfsgeometrie"
          icon="pi pi-minus"
          size="small"
          severity="secondary"
          @click="controller.toggleConstruction()"
        />
        <Button label="Löschen" icon="pi pi-trash" size="small" severity="danger" text @click="controller.deleteSelection()" />
      </div>
    </template>

    <div class="ribo-palette-section">Bedienung</div>
    <ul class="ribo-palette-help">
      <li>Werte beim Zeichnen einfach eintippen, <kbd>Tab</kbd> wechselt das Feld, <kbd>Enter</kbd> übernimmt.</li>
      <li><kbd>Esc</kbd> bricht den Schritt ab, ein zweites <kbd>Esc</kbd> beendet das Werkzeug.</li>
      <li>Blaue Geometrie ist noch beweglich, schwarze ist vollständig bestimmt.</li>
      <li>Rechte oder mittlere Maustaste verschiebt die Ansicht, das Rad zoomt.</li>
    </ul>

    <Button label="Skizze beenden" icon="pi pi-check" severity="success" size="small" fluid @click="controller.finish()" />
  </div>
</template>

<style scoped>
.ribo-palette {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ribo-palette-name {
  font-size: 0.9rem;
}

.ribo-palette-counts {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}

.ribo-palette-section {
  margin-top: 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.ribo-palette-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.ribo-palette-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.ribo-palette-buttons {
  display: flex;
  gap: 0.375rem;
  flex-wrap: wrap;
}

.ribo-palette-help {
  margin: 0;
  padding-left: 1rem;
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
  line-height: 1.5;
}

kbd {
  font-family: inherit;
  font-size: 0.75rem;
  padding: 0 0.25rem;
  border-radius: 3px;
  border: 1px solid var(--p-content-border-color);
}
</style>
