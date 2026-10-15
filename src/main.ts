/**
 * ribo bootstrap
 *
 * Initializes TSM, registers the shared libraries and loads the startup
 * modules. The Vue application itself is a module (ribo-app).
 */

import 'reflect-metadata'
import * as tsmLibrary from '@eclipse-daanse/tsm'
import { initTsmRuntime } from '@eclipse-daanse/tsm'

import * as Vue from 'vue'
import * as emfts from '@emfts/core'
import * as PrimeVueLibrary from 'primevue'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import Aura from '@primeuix/themes/aura'
import 'primeicons/primeicons.css'

import { RiboPackage } from 'ribo-model'
import { BootScreen } from './boot'
import { TsmPluginSystem } from './tsm'
import { repositories, startupModules } from './tsm/repositories.config'

function versionOf(library: string): string {
  const version = __SHARED_LIBRARY_VERSIONS__[library]
  if (!version) throw new Error(`No version known for shared library '${library}'`)
  return version
}

const boot = new BootScreen()

async function bootstrap(): Promise<void> {
  // 1. Shared libraries, before any module loads
  const tsmRuntime = initTsmRuntime()
  tsmRuntime.register('vue', Vue, versionOf('vue'))
  tsmRuntime.register('primevue', { ...PrimeVueLibrary, default: PrimeVue, PrimeVue, Tooltip, Aura }, versionOf('primevue'))
  tsmRuntime.register('@emfts/core', emfts, versionOf('@emfts/core'))
  tsmRuntime.register('@eclipse-daanse/tsm', tsmLibrary, versionOf('@eclipse-daanse/tsm'))

  // 2. The design metamodel; touching eINSTANCE builds and registers the package
  const riboPackage = RiboPackage.eINSTANCE
  emfts.EPackageRegistry.INSTANCE.set(RiboPackage.eNS_URI, riboPackage)

  // 3. Module system
  const tsm = new TsmPluginSystem({ repositories })
  tsm.registerService('tsm.system', tsm)
  tsm.onModuleEvent({
    onModuleEvent: (event) => {
      if (event.error) console.error(`TSM: ${event.moduleId} - ${event.type}`, event.error)
      boot.onModuleEvent(event)
    },
  })
  boot.setStatus('Suche Module …')
  await tsm.init()
  await tsm.loadModules(
    startupModules,
    (order) => boot.expect(order),
    (message) => boot.fail('Abhängigkeiten', message),
  )

  console.info('ribo: loaded modules', tsm.getLoadedModuleIds())
  boot.done()
}

bootstrap().catch((error) => {
  console.error('ribo: failed to start', error)
  boot.fail('Start', error)
  boot.done()
})
