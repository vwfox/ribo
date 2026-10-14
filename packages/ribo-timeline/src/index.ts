/**
 * ribo browser module: the object browser, the timeline, the actions that
 * create features, and undo/redo.
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { ACTIONS, DOCUMENT, PANELS, SKETCHER, VIEWPORT } from 'ribo-contracts'
import { isComponent, isFeature, isParameter, isSketch, type Sketch } from 'ribo-model'
import BrowserPanel from './BrowserPanel.vue'
import TimelinePanel from './TimelinePanel.vue'

const cleanups: (() => void)[] = []

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const actions = context.services.getRequired(ACTIONS)
  const viewport = context.services.getRequired(VIEWPORT)
  const editSketch = (sketch: Sketch) => context.services.get(SKETCHER)?.edit(sketch)

  const panels = context.services.getRequired(PANELS)
  const browser = markRaw(defineComponent({ name: 'RiboBrowserPanel', setup: () => () => h(BrowserPanel, { document, editSketch }) }))
  const timeline = markRaw(defineComponent({ name: 'RiboTimelinePanel', setup: () => () => h(TimelinePanel, { document, editSketch }) }))
  cleanups.push(
    panels.register({ id: 'browser', title: 'Browser', icon: 'pi pi-sitemap', location: 'left', component: browser }),
    panels.register({ id: 'timeline', title: 'Zeitleiste', icon: 'pi pi-history', location: 'bottom', component: timeline }),
  )

  const inModel = () => viewport.mode.value === 'model'
  const hasBodies = () => (document.result.value?.bodies.length ?? 0) > 0
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
      id: 'assemble.component',
      label: 'Neues Bauteil',
      icon: 'pi pi-th-large',
      group: 'assemble',
      order: 300,
      visible: inModel,
      run: () => void document.addComponent(),
    }),
    actions.register({
      id: 'assemble.joint',
      label: 'Gelenk (Ausrichten, Scharnier, Schiebe)',
      icon: 'pi pi-link',
      group: 'assemble',
      order: 301,
      shortcut: 'J',
      visible: inModel,
      enabled: () => document.design.value.components.size() > 0,
      run: () => void document.addJoint(),
    }),
    actions.register({
      id: 'create.plane',
      label: 'Konstruktionsebene',
      icon: 'svg:M3 17l6-10h12l-6 10zM12 3v4',
      group: 'create',
      order: 99,
      visible: inModel,
      run: async () => {
        const pick = await viewport.pickPlane()
        if (pick) document.addConstructionPlane(pick)
      },
    }),
    actions.register({
      id: 'create.hole',
      label: 'Bohrung (an Skizzenpunkten)',
      icon: 'svg:M8 4h8v4h-2v12h-4V8H8zM5 20h14',
      group: 'create',
      order: 112,
      shortcut: 'H',
      visible: inModel,
      enabled: () => hasBodies() && hasSketch(),
      run: () => void document.addHole(),
    }),
    actions.register({
      id: 'modify.fillet',
      label: 'Abrunden (Kanten)',
      icon: 'svg:M5 20V13a8 8 0 0 1 8-8h7M5 20h15V5',
      group: 'modify',
      order: 100,
      shortcut: 'F',
      visible: inModel,
      enabled: hasBodies,
      run: () => void document.addFillet(),
    }),
    actions.register({
      id: 'modify.chamfer',
      label: 'Fase (Kanten)',
      icon: 'svg:M5 20V11l6-6h9M5 20h15V5',
      group: 'modify',
      order: 101,
      visible: inModel,
      enabled: hasBodies,
      run: () => void document.addChamfer(),
    }),
    actions.register({
      id: 'modify.shell',
      label: 'Schale (aushöhlen)',
      icon: 'svg:M4 6v14h16V6M7 6v11h10V6',
      group: 'modify',
      order: 102,
      visible: inModel,
      enabled: hasBodies,
      run: () => void document.addShell(),
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
      enabled: () => isFeature(document.selection.value) || isParameter(document.selection.value) || isComponent(document.selection.value),
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
      enabled: () => isFeature(document.selection.value),
      run: () => {
        const selected = document.selection.value
        if (isFeature(selected)) {
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
