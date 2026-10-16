<script setup lang="ts">
import ColorPicker from 'primevue/colorpicker'
import Button from 'primevue/button'

/** A colour as #rrggbb, or '' for the automatic one */
const props = defineProps<{ label: string; modelValue: string | undefined }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

/** Quick picks: colours that read well on both light and dark grounds */
const SWATCHES = ['#14b8a6', '#60a5fa', '#f59e0b', '#a78bfa', '#f472b6', '#34d399', '#fb7185', '#facc15', '#94a3b8', '#e5e7eb', '#374151']

const current = () => (props.modelValue ?? '').toLowerCase()
</script>

<template>
  <div class="ribo-field">
    <span class="ribo-field-label">{{ label }}</span>
    <div class="ribo-colors">
      <button
        v-for="swatch in SWATCHES"
        :key="swatch"
        type="button"
        class="ribo-swatch"
        :class="{ chosen: current() === swatch }"
        :style="{ background: swatch }"
        :aria-label="swatch"
        @click="emit('update:modelValue', swatch)"
      />
      <ColorPicker
        v-tooltip="'Eigene Farbe'"
        :model-value="current().replace('#', '') || '888888'"
        format="hex"
        @update:model-value="emit('update:modelValue', `#${String($event).replace('#', '')}`)"
      />
      <Button v-if="current()" v-tooltip="'Farbe automatisch wählen'" label="Automatisch" size="small" text @click="emit('update:modelValue', '')" />
    </div>
  </div>
</template>

<style scoped>
.ribo-colors {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.ribo-swatch {
  width: 1.35rem;
  height: 1.35rem;
  padding: 0;
  border-radius: var(--radius-sm, 3px);
  border: 1px solid var(--p-content-border-color);
  cursor: pointer;
}

.ribo-swatch.chosen {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}
</style>
