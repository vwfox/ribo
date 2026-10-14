<script setup lang="ts">
import Button from 'primevue/button'
import type { PanelContribution } from 'ribo-contracts'
import type { Layout } from './layout'

const props = defineProps<{
  panel: PanelContribution
  layout: Layout
  floating?: boolean
  collapsed?: boolean
  /** Collapsing makes sense in the side areas only */
  collapsible?: boolean
}>()
const emit = defineEmits<{ grab: [event: PointerEvent] }>()

function onDragStart(event: DragEvent) {
  if (props.floating) {
    // Floating windows move with the pointer instead (see FloatingPanel)
    event.preventDefault()
    return
  }
  event.dataTransfer?.setData('application/x-ribo-panel', props.panel.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  props.layout.startDrag(props.panel.id)
}

function onDragEnd() {
  props.layout.endDrag()
}
</script>

<template>
  <div
    class="ribo-panel-header"
    :draggable="!floating"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @pointerdown="floating && emit('grab', $event)"
  >
    <i v-if="!floating" class="pi pi-arrows-alt ribo-panel-grip" />
    <h2 class="ribo-panel-title" @dblclick="collapsible && layout.toggleCollapsed(panel.id)">
      <i v-if="panel.icon" :class="panel.icon" /> {{ panel.title }}
    </h2>
    <div class="ribo-panel-buttons" @pointerdown.stop>
      <Button
        v-if="collapsible"
        v-tooltip.bottom="collapsed ? 'Aufklappen' : 'Einklappen'"
        :icon="collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
        size="small"
        text
        rounded
        @click="layout.toggleCollapsed(panel.id)"
      />
      <Button
        v-if="floating"
        v-tooltip.bottom="'Wieder andocken'"
        icon="pi pi-sign-in"
        size="small"
        text
        rounded
        @click="layout.dock(panel)"
      />
      <Button v-else v-tooltip.bottom="'Herauslösen'" icon="pi pi-external-link" size="small" text rounded @click="layout.moveTo(panel, 'float')" />
    </div>
  </div>
</template>

<style scoped>
.ribo-panel-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.25rem 0.15rem 0.5rem;
  user-select: none;
}

.ribo-panel-header[draggable='true'] {
  cursor: grab;
}

.ribo-panel-grip {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
  opacity: 0;
}

.ribo-panel-header:hover .ribo-panel-grip {
  opacity: 0.8;
}

.ribo-panel-title {
  flex: 1;
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ribo-panel-buttons {
  display: flex;
  opacity: 0.6;
}

.ribo-panel-header:hover .ribo-panel-buttons {
  opacity: 1;
}
</style>
