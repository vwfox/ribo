<script setup lang="ts">
import { computed } from 'vue'
import type { PanelContribution } from 'ribo-contracts'
import PanelHeader from './PanelHeader.vue'
import type { DockArea, Layout } from './layout'

const props = defineProps<{ area: DockArea; panels: PanelContribution[]; layout: Layout }>()

const isBottom = computed(() => props.area === 'bottom')
const activeTab = computed(() => {
  const wanted = props.layout.state.bottomTab
  return props.panels.find((p) => p.id === wanted) ?? props.panels[0]
})
const canDrop = computed(() => {
  const id = props.layout.dragging.value
  return id !== undefined && !props.panels.some((p) => p.id === id)
})
const isTarget = computed(() => canDrop.value && props.layout.dropTarget.value === props.area)

function onDragOver(event: DragEvent) {
  if (!canDrop.value) return
  event.preventDefault()
  props.layout.setDropTarget(props.area)
}

function onDragLeave(event: DragEvent) {
  const to = event.relatedTarget as Node | null
  if (!(event.currentTarget as HTMLElement).contains(to) && props.layout.dropTarget.value === props.area) props.layout.setDropTarget(undefined)
}

</script>

<template>
  <div
    class="ribo-dock"
    :class="[`ribo-dock-${area}`, { empty: panels.length === 0, 'can-drop': canDrop, 'drop-target': isTarget }]"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
  >
    <template v-if="isBottom && panels.length">
      <div class="ribo-dock-tabs">
        <div
          v-for="panel in panels"
          :key="panel.id"
          class="ribo-dock-tab"
          :class="{ active: panel === activeTab }"
          @click="layout.showTab(panel.id)"
        >
          <PanelHeader :panel="panel" :layout="layout" />
        </div>
      </div>
      <div class="ribo-dock-body">
        <component :is="panel.component" v-for="panel in panels" v-show="panel === activeTab" :key="panel.id" />
      </div>
    </template>

    <template v-else>
      <section v-for="panel in panels" :key="panel.id" class="ribo-dock-section" :class="{ collapsed: layout.state.collapsed.includes(panel.id) }">
        <PanelHeader :panel="panel" :layout="layout" :collapsed="layout.state.collapsed.includes(panel.id)" collapsible />
        <div v-show="!layout.state.collapsed.includes(panel.id)" class="ribo-dock-section-body"><component :is="panel.component" /></div>
      </section>
    </template>

    <div v-if="isTarget" class="ribo-dock-hint"><i class="pi pi-arrow-down" /> Hier andocken</div>
  </div>
</template>

<style scoped>
.ribo-dock {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--p-content-background);
}

.ribo-dock.empty {
  display: none;
}

.ribo-dock.empty.can-drop {
  display: flex;
  flex: 0 0 28px !important;
  width: 28px;
}

.ribo-dock-bottom.empty.can-drop {
  width: auto;
  height: 28px;
}

.ribo-dock.can-drop {
  outline: 2px dashed var(--p-primary-color);
  outline-offset: -2px;
}

.ribo-dock.drop-target {
  outline-style: solid;
  background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-content-background));
}

.ribo-dock-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color);
  font-size: 0.8rem;
  white-space: nowrap;
  pointer-events: none;
}

.ribo-dock-left,
.ribo-dock-right {
  overflow-y: auto;
}

.ribo-dock-section + .ribo-dock-section {
  border-top: 1px solid var(--p-content-border-color);
}

.ribo-dock-section-body {
  padding: 0 0.75rem 0.75rem;
}

.ribo-dock-tabs {
  display: flex;
  border-bottom: 1px solid var(--p-content-border-color);
}

.ribo-dock-tab {
  border-right: 1px solid var(--p-content-border-color);
  cursor: pointer;
}

.ribo-dock-tab.active {
  box-shadow: inset 0 -2px 0 var(--p-primary-color);
}

.ribo-dock-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.4rem 0.75rem;
}
</style>
