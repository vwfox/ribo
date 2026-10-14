/**
 * ribo files module: open, save, autosave and export.
 *
 * Designs are stored as emfts JSON (JSONResource). The autosave keeps the last
 * state in this browser's localStorage, so a reload does not lose work.
 */

import { watch } from 'tsm:vue'
import type { ModuleContext } from '@eclipse-daanse/tsm'
import { ACTIONS, DOCUMENT, KERNEL, NOTIFIER, type ExportFormat } from 'ribo-contracts'
import { download, fileStem, pickFile } from './files'

const AUTOSAVE_KEY = 'ribo.autosave'
const AUTOSAVE_DELAY_MS = 800
const DESIGN_EXTENSION = '.ribo.json'

const cleanups: (() => void)[] = []

function readAutosave(): string | null {
  try {
    return localStorage.getItem(AUTOSAVE_KEY)
  } catch {
    return null
  }
}

function writeAutosave(json: string): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, json)
  } catch {
    // Storage full or blocked: the design stays in memory, nothing else to do
  }
}

export async function activate(context: ModuleContext): Promise<void> {
  const document = context.services.getRequired(DOCUMENT)
  const kernel = context.services.getRequired(KERNEL)
  const notifier = context.services.getRequired(NOTIFIER)
  const actions = context.services.getRequired(ACTIONS)

  const restored = readAutosave()
  if (restored) {
    try {
      document.load(restored)
    } catch (error) {
      context.log.warn('Autosave could not be restored', error)
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const stopWatch = watch(document.revision, () => {
    clearTimeout(timer)
    timer = setTimeout(() => writeAutosave(document.save()), AUTOSAVE_DELAY_MS)
  })
  cleanups.push(stopWatch, () => clearTimeout(timer))

  const hasBodies = () => (document.result.value?.bodies.length ?? 0) > 0

  async function exportAs(format: ExportFormat) {
    try {
      const blob = await kernel.export(document.plan.value, format, document.design.value.name || 'ribo', document.placements.value)
      download(blob, `${fileStem(document.design.value.name)}.${format}`)
    } catch (error) {
      notifier.error(`Export fehlgeschlagen: ${(error as Error).message}`)
    }
  }

  cleanups.push(
    actions.register({
      id: 'file.new',
      label: 'Neues Design',
      icon: 'pi pi-file',
      group: 'file',
      order: 0,
      run: () => {
        if (document.design.value.features.size() > 0 && !confirm('Aktuelles Design verwerfen?')) return
        document.newDesign()
      },
    }),
    actions.register({
      id: 'file.open',
      label: 'Öffnen',
      icon: 'pi pi-folder-open',
      group: 'file',
      order: 1,
      shortcut: 'Ctrl+O',
      run: async () => {
        const file = await pickFile(`${DESIGN_EXTENSION},.json`)
        if (!file) return
        try {
          document.load(await file.text())
          notifier.info(`${file.name} geöffnet`)
        } catch (error) {
          notifier.error(`Öffnen fehlgeschlagen: ${(error as Error).message}`)
        }
      },
    }),
    actions.register({
      id: 'file.save',
      label: 'Speichern',
      icon: 'pi pi-save',
      group: 'file',
      order: 2,
      shortcut: 'Ctrl+S',
      run: () => {
        const json = document.save()
        download(new Blob([json], { type: 'application/json' }), `${fileStem(document.design.value.name)}${DESIGN_EXTENSION}`)
      },
    }),
    actions.register({
      id: 'file.export3mf',
      label: 'Als 3MF exportieren (3D-Druck, empfohlen)',
      icon: 'pi pi-download',
      group: 'file',
      order: 3,
      shortcut: 'Ctrl+E',
      enabled: hasBodies,
      run: () => exportAs('3mf'),
    }),
    actions.register({
      id: 'file.exportStl',
      label: 'Als STL exportieren',
      icon: 'pi pi-file-export',
      group: 'file',
      order: 4,
      enabled: hasBodies,
      run: () => exportAs('stl'),
    }),
    actions.register({
      id: 'file.exportStep',
      label: 'Als STEP exportieren',
      icon: 'pi pi-share-alt',
      group: 'file',
      order: 5,
      enabled: hasBodies,
      run: () => exportAs('step'),
    }),
  )
}

export async function deactivate(): Promise<void> {
  cleanups.splice(0).forEach((cleanup) => cleanup())
}
