/**
 * ribo properties module: edits the selected object on the right.
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { DOCUMENT, PANELS, SKETCHER, VIEWPORT } from 'ribo-contracts'
import type { Sketch } from 'ribo-model'
import PropertiesPanel from './PropertiesPanel.vue'

const cleanups: (() => void)[] = []

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const viewport = context.services.getRequired(VIEWPORT)
  const editSketch = (sketch: Sketch) => context.services.get(SKETCHER)?.edit(sketch)
  const panel = markRaw(defineComponent({ name: 'RiboPropertiesPanel', setup: () => () => h(PropertiesPanel, { document, editSketch }) }))
  cleanups.push(
    context.services.getRequired(PANELS).register({
      id: 'properties',
      title: 'Eigenschaften',
      icon: 'pi pi-sliders-v',
      location: 'right',
      component: panel,
      order: 10,
      visible: () => viewport.mode.value === 'model',
    }),
  )
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
