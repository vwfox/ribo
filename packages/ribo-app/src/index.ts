/**
 * ribo application module
 *
 * Creates and mounts the Vue application and provides the workbench
 * registries other modules contribute their panels and actions to.
 */

import { createApp } from 'tsm:vue'
import type { App } from 'vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { PrimeVue, Aura, Tooltip, ToastService } from 'tsm:primevue'
import { ACTIONS, APP, NOTIFIER, PANELS, type Notifier } from 'ribo-contracts'

import AppComponent from './App.vue'
import { createActionRegistry, createPanelRegistry } from './registries'

let app: App | null = null
let colorScheme: MediaQueryList | null = null

const applyColorScheme = () => {
  document.documentElement.classList.toggle('dark-theme', colorScheme?.matches === true)
}

export async function activate(context: ModuleContext): Promise<void> {
  const panels = createPanelRegistry()
  const actions = createActionRegistry()

  app = createApp(AppComponent)
  app.use(PrimeVue, { theme: { preset: Aura, options: { darkModeSelector: '.dark-theme' } } })
  app.use(ToastService)
  app.directive('tooltip', Tooltip)
  app.provide(PANELS, panels)
  app.provide(ACTIONS, actions)

  colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
  colorScheme.addEventListener('change', applyColorScheme)
  applyColorScheme()

  app.mount('#app')

  const toast = app.config.globalProperties.$toast
  const notifier: Notifier = {
    info: (message) => toast.add({ severity: 'info', summary: message, life: 3000 }),
    error: (message) => toast.add({ severity: 'error', summary: message, life: 6000 }),
  }

  context.services.register(APP, app)
  context.services.register(PANELS, panels)
  context.services.register(ACTIONS, actions)
  context.services.register(NOTIFIER, notifier)
}

export async function deactivate(): Promise<void> {
  colorScheme?.removeEventListener('change', applyColorScheme)
  colorScheme = null
  app?.unmount()
  app = null
}
