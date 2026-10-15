/**
 * ribo screwed joints: the "Verschrauben" action and the bill of materials.
 * The screwed joint itself is a feature of the design (Fastening); its holes
 * are lined up by the assembly solver, its screws chosen by ribo-parts.
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { ACTIONS, DOCUMENT, PANELS, VIEWPORT } from 'ribo-contracts'
import BomPanel from './BomPanel.vue'

const cleanups: (() => void)[] = []

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const viewport = context.services.getRequired(VIEWPORT)
  const inModel = () => viewport.mode.value === 'model'
  const panel = markRaw(defineComponent({ name: 'RiboBomPanel', setup: () => () => h(BomPanel, { document }) }))
  cleanups.push(
    context.services.getRequired(PANELS).register({
      id: 'bom',
      title: 'Stückliste',
      icon: 'pi pi-list',
      location: 'bottom',
      component: panel,
      // After the timeline, which stays the first tab
      order: 200,
      visible: inModel,
    }),
    context.services.getRequired(ACTIONS).register({
      id: 'assemble.fasten',
      label: 'Verschrauben (Bohrungen ausrichten, Schraube, Scheibe, Mutter)',
      icon: 'pi pi-cog',
      group: 'assemble',
      order: 304,
      shortcut: 'B',
      visible: inModel,
      enabled: () => document.design.value.components.size() > 0,
      run: () => void document.addFastening(),
    }),
  )
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
