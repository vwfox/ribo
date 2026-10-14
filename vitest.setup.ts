/**
 * Vitest global setup.
 *
 * The TSM Vite plugin rewrites `import { x } from 'tsm:mod'` into
 * `const { x } = __tsm__.require('mod')`. In the running app the TSM runtime
 * installs `__tsm__`; in tests it is not bootstrapped, so a minimal global
 * resolves the shared libraries to the real packages.
 */
import * as vue from 'vue'
import * as emfts from '@emfts/core'

const sharedModules: Record<string, unknown> = {
  vue,
  '@emfts/core': emfts,
}

;(globalThis as Record<string, unknown>).__tsm__ = {
  require: (id: string) => sharedModules[id] ?? {},
  register: () => {},
}
