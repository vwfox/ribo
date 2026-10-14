import { markRaw, shallowReactive } from 'vue'
import type { ActionContribution, ActionRegistry, PanelContribution, PanelRegistry } from 'ribo-contracts'

const byOrder = (a: { order?: number }, b: { order?: number }) => (a.order ?? 100) - (b.order ?? 100)

export function createPanelRegistry(): PanelRegistry {
  const panels = shallowReactive<PanelContribution[]>([])
  return {
    panels,
    register(panel) {
      const entry = { ...panel, component: markRaw(panel.component) }
      panels.push(entry)
      panels.sort(byOrder)
      return () => {
        const index = panels.indexOf(entry)
        if (index >= 0) panels.splice(index, 1)
      }
    },
  }
}

export function createActionRegistry(): ActionRegistry {
  const actions = shallowReactive<ActionContribution[]>([])
  return {
    actions,
    register(action) {
      actions.push(action)
      actions.sort(byOrder)
      return () => {
        const index = actions.indexOf(action)
        if (index >= 0) actions.splice(index, 1)
      }
    },
    async run(id) {
      const action = actions.find((a) => a.id === id)
      if (!action || action.enabled?.() === false) return
      await action.run()
    },
  }
}

/** Normalizes a key event to the shortcut notation used by actions, e.g. 'Ctrl+Shift+S'. */
export function shortcutOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  parts.push(key)
  return parts.join('+')
}
