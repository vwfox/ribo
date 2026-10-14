/**
 * ribo viewport module: the 3D view in the centre of the workbench, and the
 * viewport service (sketch view, plane picking, overlays).
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { DOCUMENT, PANELS, VIEWPORT } from 'ribo-contracts'
import RiboViewport from './RiboViewport.vue'
import { ViewportController } from './ViewportController'

const cleanups: (() => void)[] = []

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const controller = new ViewportController()
  const panel = markRaw(defineComponent({ name: 'RiboViewportPanel', setup: () => () => h(RiboViewport, { document, controller }) }))
  cleanups.push(context.services.getRequired(PANELS).register({ id: 'viewport', title: 'Ansicht', location: 'center', component: panel }))
  context.services.register(VIEWPORT, controller)
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
