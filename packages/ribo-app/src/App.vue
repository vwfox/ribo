<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import Button from 'primevue/button'
import Toast from 'primevue/toast'
import { ACTIONS, PANELS, type ActionContribution, type ActionRegistry, type PanelLocation, type PanelRegistry } from 'ribo-contracts'
import { shortcutOf } from './registries'
import DockArea from './DockArea.vue'
import FloatingPanel from './FloatingPanel.vue'
import { LAYOUT, type DockArea as Area, type Layout } from './layout'

const panels = inject(PANELS) as PanelRegistry
const actions = inject(ACTIONS) as ActionRegistry
const layout = inject(LAYOUT) as Layout

const GROUP_LABELS: Record<string, string> = {
  file: 'Datei',
  edit: 'Bearbeiten',
  create: 'Erstellen',
  modify: 'Ändern',
  assemble: 'Zusammenbauen',
  view: 'Ansicht',
  'sketch-create': 'Skizze erstellen',
  'sketch-modify': 'Ändern',
  'sketch-constraints': 'Abhängigkeiten',
  'sketch-finish': 'Beenden',
}

const isVisible = (item: { visible?: () => boolean }) => item.visible?.() !== false

const groups = computed(() => {
  const result = new Map<string, ActionContribution[]>()
  for (const action of actions.actions) {
    if (!isVisible(action)) continue
    if (!result.has(action.group)) result.set(action.group, [])
    result.get(action.group)!.push(action)
  }
  return [...result.entries()]
})

const visiblePanels = computed(() => panels.panels.filter(isVisible))
const panelsAt = (area: Area | 'float' | PanelLocation) => visiblePanels.value.filter((p) => layout.areaOf(p) === area)
const left = computed(() => panelsAt('left'))
const center = computed(() => panelsAt('center'))
const right = computed(() => panelsAt('right'))
const bottom = computed(() => panelsAt('bottom'))
const floating = computed(() => panelsAt('float'))

const workbench = ref<HTMLElement>()
const centerArea = ref<HTMLElement>()
const workbenchBounds = () => workbench.value?.getBoundingClientRect()

/** Over the viewport a dragged panel would float */
function onCenterDragOver(event: DragEvent) {
  if (!layout.dragging.value) return
  event.preventDefault()
  layout.setDropTarget('float')
}

function onDrop(event: DragEvent) {
  const id = event.dataTransfer?.getData('application/x-ribo-panel') || layout.dragging.value
  const panel = panels.panels.find((p) => p.id === id)
  const target = layout.dropTarget.value
  layout.endDrag()
  if (!panel || !target) return
  event.preventDefault()
  if (target === 'float') {
    const bounds = workbenchBounds()
    layout.moveTo(panel, 'float', { x: event.clientX - (bounds?.left ?? 0) - 40, y: event.clientY - (bounds?.top ?? 0) - 12 })
  } else {
    layout.moveTo(panel, target)
  }
}

/** Splitters: drag the edge of a dock area to resize it */
function startResize(event: PointerEvent, area: Area) {
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const bounds = workbenchBounds()!
  const move = (e: PointerEvent) => {
    if (area === 'left') layout.resize('left', e.clientX - bounds.left)
    else if (area === 'right') layout.resize('right', bounds.right - e.clientX)
    else layout.resize('bottom', bounds.bottom - e.clientY)
  }
  const up = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = area === 'bottom' ? 'row-resize' : 'col-resize'
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

const tooltipOf = (action: ActionContribution) => (action.shortcut ? `${action.label} (${action.shortcut})` : action.label)

function onKeyDown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
  const shortcut = shortcutOf(event)
  // While typing only shortcuts with a modifier count; Delete belongs to the field
  if (typing && !shortcut.includes('Ctrl')) return
  const action = actions.actions.find((a) => a.shortcut === shortcut && isVisible(a) && a.enabled?.() !== false)
  if (!action) return
  event.preventDefault()
  void actions.run(action.id)
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="ribo-shell">
    <header class="ribo-toolbar">
      <div class="ribo-brand">
        <img src="/ribo-icon.svg" alt="" width="22" height="22" />
        <span>ribo</span>
      </div>
      <div v-for="[group, items] in groups" :key="group" class="ribo-toolbar-group">
        <span class="ribo-toolbar-label">{{ GROUP_LABELS[group] ?? group }}</span>
        <div class="ribo-toolbar-buttons">
          <Button
            v-for="action in items"
            :key="action.id"
            v-tooltip.bottom="tooltipOf(action)"
            :icon="action.icon?.startsWith('pi ') ? action.icon : undefined"
            :label="action.icon ? undefined : action.label"
            :aria-label="action.label"
            :disabled="action.enabled?.() === false"
            :class="{ 'ribo-tool-active': action.active?.() }"
            severity="secondary"
            text
            size="small"
            @click="actions.run(action.id)"
          >
            <template v-if="action.icon?.startsWith('svg:')" #icon>
              <svg class="ribo-tool-icon" viewBox="0 0 24 24"><path :d="action.icon.slice(4)" /></svg>
            </template>
            <template v-else-if="action.icon?.startsWith('text:')" #icon>
              <span class="ribo-tool-text">{{ action.icon.slice(5) }}</span>
            </template>
          </Button>
        </div>
      </div>
    </header>

    <main ref="workbench" class="ribo-workbench" @drop="onDrop" @dragover.prevent>
      <DockArea area="left" :panels="left" :layout="layout" :style="{ flexBasis: `${layout.state.sizes.left}px` }" class="ribo-side ribo-side-left" />
      <div v-if="left.length" class="ribo-splitter vertical" @pointerdown="startResize($event, 'left')" />

      <div class="ribo-middle">
        <section ref="centerArea" class="ribo-center" :class="{ 'float-target': layout.dropTarget.value === 'float' }" @dragover="onCenterDragOver">
          <component :is="panel.component" v-for="panel in center" :key="panel.id" />
          <div v-if="layout.dropTarget.value === 'float'" class="ribo-float-hint"><i class="pi pi-external-link" /> Als Fenster ablegen</div>
        </section>
        <div v-if="bottom.length" class="ribo-splitter horizontal" @pointerdown="startResize($event, 'bottom')" />
        <DockArea area="bottom" :panels="bottom" :layout="layout" :style="{ flexBasis: `${layout.state.sizes.bottom}px` }" class="ribo-bottom" />
      </div>

      <div v-if="right.length" class="ribo-splitter vertical" @pointerdown="startResize($event, 'right')" />
      <DockArea area="right" :panels="right" :layout="layout" :style="{ flexBasis: `${layout.state.sizes.right}px` }" class="ribo-side ribo-side-right" />

      <FloatingPanel v-for="panel in floating" :key="panel.id" :panel="panel" :layout="layout" :bounds="workbenchBounds" />
    </main>

    <Toast position="bottom-right" />
  </div>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

/* The theme's type: rem follows its base size, so PrimeVue and the panels are as compact as daanse board */
html {
  font-size: var(--text-base, 13px);
}

body {
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-base, 13px);
  background: var(--color-bg, var(--p-content-background));
  color: var(--color-fg, var(--p-text-color));
}

code,
kbd,
pre {
  font-family: var(--font-mono, ui-monospace, monospace);
}

/* Scrollbars in the theme's colours */
* {
  scrollbar-color: var(--color-outline) transparent;
  scrollbar-width: thin;
}

.ribo-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.ribo-toolbar {
  display: flex;
  align-items: stretch;
  gap: 1rem;
  padding: 0.25rem 0.75rem;
  border-bottom: 1px solid var(--p-content-border-color);
  background: var(--p-content-background);
}

.ribo-brand {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 700;
  font-size: 1.05rem;
  padding-right: 0.5rem;
  border-right: 1px solid var(--p-content-border-color);
}

.ribo-toolbar-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-right: 1rem;
  border-right: 1px solid var(--p-content-border-color);
}

.ribo-toolbar-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.ribo-toolbar-buttons {
  display: flex;
  gap: 0.125rem;
}

.ribo-tool-icon {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ribo-tool-text {
  display: inline-block;
  min-width: 1.15rem;
  font-weight: 700;
  font-size: 0.85rem;
  line-height: 1.15rem;
  text-align: center;
}

.ribo-toolbar .ribo-tool-active {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
}

.ribo-workbench {
  position: relative;
  flex: 1;
  display: flex;
  min-height: 0;
}

.ribo-side {
  flex: 0 0 300px;
}

.ribo-side-left {
  border-right: 1px solid var(--p-content-border-color);
}

.ribo-side-right {
  border-left: 1px solid var(--p-content-border-color);
}

.ribo-middle {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ribo-center {
  flex: 1;
  position: relative;
  min-height: 0;
}

.ribo-center.float-target {
  outline: 2px dashed var(--p-primary-color);
  outline-offset: -4px;
}

.ribo-float-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 30;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color);
  font-size: 0.8rem;
  pointer-events: none;
}

.ribo-bottom {
  flex: 0 0 150px;
  max-height: 70%;
  border-top: 1px solid var(--p-content-border-color);
}

.ribo-splitter {
  flex: none;
  z-index: 5;
  background: transparent;
  transition: background 0.15s;
}

.ribo-splitter.vertical {
  width: 5px;
  margin: 0 -2px;
  cursor: col-resize;
}

.ribo-splitter.horizontal {
  height: 5px;
  margin: -2px 0;
  cursor: row-resize;
}

.ribo-splitter:hover {
  background: var(--p-primary-color);
}
</style>
