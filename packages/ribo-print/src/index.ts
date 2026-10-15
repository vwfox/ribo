/**
 * ribo 3D printing module: checks the bodies for printability, estimates
 * material, marks problems in the viewport and exports 3MF/STL.
 */

import { computed, defineComponent, h, markRaw, ref, shallowRef, watch } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { DOCUMENT, KERNEL, NOTIFIER, PANELS, PRINT, VIEWPORT, type ExportFormat } from 'ribo-contracts'
import { analyse, type PrintReport } from './analysis'
import { loadSettings, saveSettings, type PrintSettings } from './settings'
import PrintPanel from './PrintPanel.vue'

const ANALYSIS_DELAY_MS = 250
const OVERHANG_COLOR = '#ef4444'
const THIN_COLOR = '#f59e0b'

const cleanups: (() => void)[] = []

/** A design name as a safe file name stem */
function fileStem(name: string | undefined): string {
  const stem = (name ?? '').trim().replace(/[^\w\-äöüÄÖÜß ]+/g, '').replace(/\s+/g, '_')
  return stem || 'design'
}

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const viewport = context.services.getRequired(VIEWPORT)
  const kernel = context.services.getRequired(KERNEL)
  const notifier = context.services.getRequired(NOTIFIER)

  const settings = ref<PrintSettings>(loadSettings())
  const report = shallowRef<PrintReport | undefined>()
  const marks = ref({ overhangs: false, thin: false })

  viewport.setBed(settings.value.bed)
  context.services.register(PRINT, { material: computed(() => settings.value.material) })

  /** Shows the switched-on marks; none while a sketch is open */
  const showMarks = () => {
    const sketching = viewport.mode.value === 'sketch'
    const current = report.value
    viewport.setAnalysisLayer({
      id: 'print.overhangs',
      color: OVERHANG_COLOR,
      positions: !sketching && marks.value.overhangs && current ? current.overhangs.positions : new Float32Array(),
    })
    viewport.setAnalysisLayer({
      id: 'print.thin',
      color: THIN_COLOR,
      positions: !sketching && marks.value.thin && current ? current.thin.positions : new Float32Array(),
    })
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const reanalyse = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      report.value = analyse(document.result.value?.bodies ?? [], settings.value)
      showMarks()
    }, ANALYSIS_DELAY_MS)
  }

  cleanups.push(
    watch(() => document.result.value, reanalyse, { immediate: true }),
    watch(settings, (next) => {
      saveSettings(next)
      viewport.setBed(next.bed)
      reanalyse()
    }),
    watch([marks, viewport.mode], showMarks, { deep: true }),
    () => clearTimeout(timer),
  )

  async function exportAs(format: ExportFormat) {
    try {
      const name = document.design.value.name
      const blob = await kernel.export(document.plan.value, format, name || 'ribo', document.placements.value)
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${fileStem(name)}.${format}`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      notifier.error(`Export fehlgeschlagen: ${(error as Error).message}`)
    }
  }

  const panel = markRaw(
    defineComponent({
      name: 'RiboPrintPanel',
      setup: () => () =>
        h(PrintPanel, {
          report,
          settings,
          marks,
          update: (next: PrintSettings) => {
            settings.value = next
          },
          setMark: (kind: 'overhangs' | 'thin', on: boolean) => {
            marks.value = { ...marks.value, [kind]: on }
          },
          exportAs,
        }),
    }),
  )
  cleanups.push(
    context.services.getRequired(PANELS).register({
      id: 'print',
      title: '3D-Druck',
      icon: 'pi pi-print',
      location: 'right',
      component: panel,
      order: 20,
      visible: () => viewport.mode.value === 'model',
    }),
  )
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
