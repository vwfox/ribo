<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted } from 'vue'
import Button from 'primevue/button'
import Toast from 'primevue/toast'
import { ACTIONS, PANELS, type ActionContribution, type ActionRegistry, type PanelLocation, type PanelRegistry } from 'ribo-contracts'
import { shortcutOf } from './registries'

const panels = inject(PANELS) as PanelRegistry
const actions = inject(ACTIONS) as ActionRegistry

const GROUP_LABELS: Record<string, string> = {
  file: 'Datei',
  edit: 'Bearbeiten',
  create: 'Erstellen',
  modify: 'Ändern',
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

const panelsAt = (location: PanelLocation) => panels.panels.filter((p) => p.location === location && isVisible(p))
const left = computed(() => panelsAt('left'))
const center = computed(() => panelsAt('center'))
const right = computed(() => panelsAt('right'))

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

    <main class="ribo-workbench">
      <aside v-if="left.length" class="ribo-side ribo-side-left">
        <section v-for="panel in left" :key="panel.id" class="ribo-panel">
          <h2 class="ribo-panel-title"><i v-if="panel.icon" :class="panel.icon" /> {{ panel.title }}</h2>
          <div class="ribo-panel-body"><component :is="panel.component" /></div>
        </section>
      </aside>

      <section class="ribo-center">
        <component :is="panel.component" v-for="panel in center" :key="panel.id" />
      </section>

      <aside v-if="right.length" class="ribo-side ribo-side-right">
        <section v-for="panel in right" :key="panel.id" class="ribo-panel">
          <h2 class="ribo-panel-title"><i v-if="panel.icon" :class="panel.icon" /> {{ panel.title }}</h2>
          <div class="ribo-panel-body"><component :is="panel.component" /></div>
        </section>
      </aside>
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

body {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  background: var(--p-content-background);
  color: var(--p-text-color);
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
  flex: 1;
  display: flex;
  min-height: 0;
}

.ribo-side {
  width: 300px;
  flex: none;
  overflow-y: auto;
  background: var(--p-content-background);
}

.ribo-side-left {
  border-right: 1px solid var(--p-content-border-color);
}

.ribo-side-right {
  border-left: 1px solid var(--p-content-border-color);
}

.ribo-center {
  flex: 1;
  position: relative;
  min-width: 0;
}

.ribo-panel + .ribo-panel {
  border-top: 1px solid var(--p-content-border-color);
}

.ribo-panel-title {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.ribo-panel-body {
  padding: 0 0.75rem 0.75rem;
}
</style>
