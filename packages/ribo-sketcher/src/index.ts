/**
 * ribo sketcher module: sketch mode with its tools, drawn over the viewport.
 */

import { defineComponent, h, markRaw } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { ACTIONS, DOCUMENT, NOTIFIER, PANELS, SKETCHER, VIEWPORT, type ActionContribution } from 'ribo-contracts'
import { CONSTRAINT_TOOLS, SketcherController } from './SketcherController'
import SketchOverlay from './SketchOverlay.vue'
import SketchPalette from './SketchPalette.vue'

const cleanups: (() => void)[] = []

/** Toolbar icons, 24×24 stroked paths */
const ICONS = {
  line: 'svg:M5 19L19 5M3.5 19a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M17.5 5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  rectangle: 'svg:M4 6h16v12H4z',
  centerRectangle: 'svg:M4 6h16v12H4zM10 12h4M12 10v4',
  circle: 'svg:M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16zM11 12h2',
  arc: 'svg:M4 18A9 9 0 0 1 20 18M2.5 18h3M18.5 18h3',
  polygon: 'svg:M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z',
  slot: 'svg:M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z',
  point: 'svg:M12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM12 4v3M12 17v3M4 12h3M17 12h3',
  fillet: 'svg:M5 20V13a8 8 0 0 1 8-8h7',
  trim: 'svg:M6 7a2 2 0 1 0 0 .01M6 17a2 2 0 1 0 0 .01M8 8l12 10M8 16l12-10',
  construction: 'svg:M4 20l2.5-2.5M9 15l2.5-2.5M14 10l2.5-2.5M19 5l1-1',
  offset: 'svg:M4 18L14 8h6M4 13l6-6h10',
  project: 'svg:M12 3v10M8 9l4 4 4-4M4 17l8 4 8-4-8-4z',
  mirror: 'svg:M12 3v18M9 7L4 17h5zM15 7l5 10h-5z',
  rectPattern: 'svg:M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 15h5v5h-5z',
  circPattern: 'svg:M12 3.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M19 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M12 17.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3M5 10.5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3',
  dimension: 'svg:M4 7v10M20 7v10M4 12h16M7.5 9.5L4 12l3.5 2.5M16.5 9.5L20 12l-3.5 2.5',
  sketch: 'svg:M4 20h16M6 16l9-9 3 3-9 9H6z',
}

const CONSTRAINT_TEXT: Record<string, string> = {
  hv: 'H|V',
  coincident: '•',
  parallel: '∥',
  perpendicular: '⊥',
  tangent: 'T',
  equal: '=',
  midpoint: 'M',
  concentric: '◎',
  collinear: '≡',
  symmetric: '⇋',
  fix: '⚲',
}

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const viewport = context.services.getRequired(VIEWPORT)
  const notifier = context.services.getRequired(NOTIFIER)
  const actions = context.services.getRequired(ACTIONS)
  const controller = new SketcherController(document, viewport, notifier)
  context.services.register(SKETCHER, controller)

  const overlay = markRaw(defineComponent({ name: 'RiboSketchOverlay', setup: () => () => h(SketchOverlay, { controller, document }) }))
  cleanups.push(viewport.registerOverlay(overlay))

  const palette = markRaw(defineComponent({ name: 'RiboSketchPalette', setup: () => () => h(SketchPalette, { controller, document }) }))
  cleanups.push(
    context.services.getRequired(PANELS).register({
      id: 'sketch-palette',
      title: 'Skizzenpalette',
      icon: 'pi pi-sliders-h',
      location: 'right',
      component: palette,
      order: 0,
      visible: () => controller.active.value !== undefined,
    }),
  )

  const inSketch = () => controller.active.value !== undefined
  const inModel = () => controller.active.value === undefined

  const register = (action: ActionContribution) => cleanups.push(actions.register(action))

  register({
    id: 'create.sketch',
    label: 'Skizze erstellen',
    icon: ICONS.sketch,
    group: 'create',
    order: 100,
    shortcut: 'S',
    visible: inModel,
    run: () => controller.createSketch(),
  })

  const tool = (id: keyof typeof ICONS, label: string, group: string, order: number, shortcut?: string): ActionContribution => ({
    id: `sketch.${id}`,
    label,
    icon: ICONS[id],
    group,
    order,
    shortcut,
    visible: inSketch,
    active: () => controller.tool.value === id,
    run: () => controller.setTool(controller.tool.value === id ? 'select' : id),
  })

  register(tool('line', 'Linie', 'sketch-create', 10, 'L'))
  register(tool('rectangle', 'Rechteck (2 Punkte)', 'sketch-create', 11, 'R'))
  register(tool('centerRectangle', 'Rechteck (Mittelpunkt)', 'sketch-create', 12))
  register(tool('circle', 'Kreis (Mittelpunkt, Durchmesser)', 'sketch-create', 13, 'C'))
  register(tool('arc', 'Bogen (3 Punkte)', 'sketch-create', 14, 'A'))
  register(tool('polygon', 'Polygon (umschrieben)', 'sketch-create', 15, 'P'))
  register(tool('slot', 'Langloch', 'sketch-create', 16))
  register(tool('point', 'Punkt', 'sketch-create', 17))
  register(tool('fillet', 'Abrunden', 'sketch-modify', 20, 'F'))
  register(tool('trim', 'Stutzen', 'sketch-modify', 21, 'T'))
  register(tool('offset', 'Versatz', 'sketch-modify', 23, 'O'))
  register(tool('project', 'Projizieren (Körperkanten, Achsen)', 'sketch-create', 18, 'J'))
  register(tool('mirror', 'Spiegeln', 'sketch-modify', 24, 'M'))
  register(tool('rectPattern', 'Rechteckiges Muster', 'sketch-modify', 25))
  register(tool('circPattern', 'Kreisförmiges Muster', 'sketch-modify', 26))
  register({
    id: 'sketch.construction',
    label: 'Hilfsgeometrie umschalten',
    icon: ICONS.construction,
    group: 'sketch-modify',
    order: 22,
    shortcut: 'X',
    visible: inSketch,
    run: () => controller.toggleConstruction(),
  })
  register(tool('dimension', 'Bemaßung', 'sketch-constraints', 30, 'D'))
  CONSTRAINT_TOOLS.forEach((info, i) =>
    register({
      id: `sketch.${info.id}`,
      label: info.label,
      icon: `text:${CONSTRAINT_TEXT[info.id] ?? '?'}`,
      group: 'sketch-constraints',
      order: 31 + i,
      shortcut: info.shortcut,
      visible: inSketch,
      active: () => controller.tool.value === info.id,
      run: () => controller.setTool(controller.tool.value === info.id ? 'select' : info.id),
    }),
  )
  register({
    id: 'sketch.finish',
    label: 'Skizze beenden',
    icon: 'pi pi-check',
    group: 'sketch-finish',
    order: 90,
    shortcut: 'Ctrl+Enter',
    visible: inSketch,
    run: () => controller.finish(),
  })
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
