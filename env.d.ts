/// <reference types="vite/client" />

/** Versions of the shared libraries, set at build time by vite.config.ts */
declare const __SHARED_LIBRARY_VERSIONS__: Record<string, string>

declare module 'tsm:vue' {
  export * from 'vue'
}

declare module 'tsm:primevue' {
  export * from 'primevue'
  export { default as PrimeVue } from 'primevue/config'
  export { default as Tooltip } from 'primevue/tooltip'
  export { default as ToastService } from 'primevue/toastservice'
  export { default as Aura } from '@primeuix/themes/aura'
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
