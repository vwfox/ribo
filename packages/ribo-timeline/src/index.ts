/**
 * ribo browser module: parameters and timeline on the left, the actions that
 * create features, and undo/redo.
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { ACTIONS, DOCUMENT, PANELS, SKETCHER, VIEWPORT } from 'ribo-contracts'
import { isFeature, isParameter, isProfileFeature, isSketch, type Sketch } from 'ribo-model'
import TimelinePanel from './TimelinePanel.vue'

const cleanups: (() => void)[] = []

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const actions = context.services.getRequired(ACTIONS)
  const viewport = context.services.getRequired(VIEWPORT)
  const editSketch = (sketch: Sketch) => context.services.get(SKETCHER)?.edit(sketch)

  const panel = markRaw(defineComponent({ name: 'RiboTimelinePanel', setup: () => () => h(TimelinePanel, { document, editSketch }) }))
  cleanups.push(context.services.getRequired(PANELS).register({ id: 'browser', title: 'Browser', icon: 'pi pi-list', location: 'left', component: panel }))

  const inModel = () => viewport.mode.value === 'model'
  const hasSketch = () => {
    void document.revision.value
    return document.design.value.features.toArray().some(isSketch)
  }

  cleanups.push(
    actions.register({
      id: 'create.extrude',
      label: 'Extrudieren',
      icon: 'pi pi-box',
      group: 'create',
      order: 110,
      shortcut: 'E',
      visible: inModel,
      enabled: hasSketch,
      run: () => void document.addExtrude(),
    }),
    actions.register({
      id: 'create.revolve',
      label: 'Drehen',
      icon: 'pi pi-sync',
      group: 'create',
      order: 111,
      visible: inModel,
      enabled: hasSketch,
      run: () => void document.addRevolve(),
    }),
    actions.register({
      id: 'edit.undo',
      label: 'Rückgängig',
      icon: 'pi pi-undo',
      group: 'edit',
      order: 50,
      shortcut: 'Ctrl+Z',
      enabled: () => document.history.canUndo.value,
      run: () => document.history.undo(),
    }),
    actions.register({
      id: 'edit.redo',
      label: 'Wiederholen',
      icon: 'pi pi-refresh',
      group: 'edit',
      order: 51,
      shortcut: 'Ctrl+Y',
      enabled: () => document.history.canRedo.value,
      run: () => document.history.redo(),
    }),
    actions.register({
      id: 'edit.redoAlt',
      label: 'Wiederholen',
      group: 'edit',
      shortcut: 'Ctrl+Shift+Z',
      visible: () => false,
      run: () => document.history.redo(),
    }),
    actions.register({
      id: 'modify.delete',
      label: 'Löschen',
      icon: 'pi pi-trash',
      group: 'modify',
      order: 200,
      shortcut: 'Delete',
      visible: inModel,
      enabled: () => isFeature(document.selection.value) || isParameter(document.selection.value),
      run: () => {
        const selected = document.selection.value
        if (selected) document.remove(selected)
      },
    }),
    actions.register({
      id: 'modify.suppress',
      label: 'Unterdrücken umschalten',
      icon: 'pi pi-eye-slash',
      group: 'modify',
      order: 201,
      visible: inModel,
      enabled: () => isSketch(document.selection.value) || isProfileFeature(document.selection.value),
      run: () => {
        const selected = document.selection.value
        if (isSketch(selected) || isProfileFeature(selected)) {
          document.history.record('Unterdrücken', () => {
            selected.suppressed = !selected.suppressed
          })
        }
      },
    }),
  )
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
