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

const isCollapsed = (panel: PanelContribution) => props.layout.state.collapsed.includes(panel.id)

const sections: (HTMLElement | undefined)[] = []
const MIN_SECTION_PX = 60

/** Dragging the divider above panel i shares the height of it and the panel before it anew */
function startSplit(event: PointerEvent, i: number) {
  const above = props.panels[i - 1]
  const below = props.panels[i]
  const top = sections[i - 1]
  const bottom = sections[i]
  if (!above || !below || !top || !bottom) return
  const divider = event.currentTarget as HTMLElement
  divider.setPointerCapture(event.pointerId)
  const start = event.clientY
  const heights = [top.getBoundingClientRect().height, bottom.getBoundingClientRect().height] as const
  const total = heights[0] + heights[1]
  const weights = props.layout.weightOf(above.id) + props.layout.weightOf(below.id)
  const move = (e: PointerEvent) => {
    const upper = Math.min(total - MIN_SECTION_PX, Math.max(MIN_SECTION_PX, heights[0] + e.clientY - start))
    props.layout.setWeight(above.id, (weights * upper) / total)
    props.layout.setWeight(below.id, (weights * (total - upper)) / total)
  }
  const up = () => {
    divider.removeEventListener('pointermove', move)
    divider.removeEventListener('pointerup', up)
  }
  divider.addEventListener('pointermove', move)
  divider.addEventListener('pointerup', up)
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
      <template v-for="(panel, i) in panels" :key="panel.id">
        <div
          v-if="i > 0 && !isCollapsed(panel) && !isCollapsed(panels[i - 1]!)"
          class="ribo-dock-divider"
          title="Ziehen verteilt die Höhe"
          @pointerdown.prevent="startSplit($event, i)"
        />
        <section
          :ref="(el) => (sections[i] = el as HTMLElement | undefined)"
          class="ribo-dock-section"
          :class="{ collapsed: isCollapsed(panel) }"
          :style="isCollapsed(panel) ? undefined : { flexGrow: layout.weightOf(panel.id) }"
        >
          <PanelHeader :panel="panel" :layout="layout" :collapsed="isCollapsed(panel)" collapsible />
          <div v-show="!isCollapsed(panel)" class="ribo-dock-section-body"><component :is="panel.component" /></div>
        </section>
      </template>
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

.ribo-dock-section {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}

.ribo-dock-section.collapsed {
  flex: none;
}

.ribo-dock-section + .ribo-dock-section {
  border-top: 1px solid var(--p-content-border-color);
}

.ribo-dock-section-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0.75rem 0.75rem;
}

.ribo-dock-divider {
  flex: none;
  height: 5px;
  margin: -2px 0;
  position: relative;
  z-index: 1;
  cursor: row-resize;
  touch-action: none;
}

.ribo-dock-divider:hover,
.ribo-dock-divider:active {
  background: var(--p-primary-color);
}

.ribo-dock-divider + .ribo-dock-section {
  border-top: 1px solid var(--p-content-border-color);
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
