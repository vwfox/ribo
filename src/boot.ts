/**
 * The start screen: progress, the modules as they load, and every error on
 * the way. Plain DOM on the markup in index.html - it must work even when
 * Vue or a module does not.
 *
 * Modelled on daanse board's boot bundle. With errors the screen stays up
 * until the user goes on, so a failed start is never silent.
 */

import type { ModuleEvent } from '@eclipse-daanse/tsm'

interface BootError {
  source: string
  message: string
}

/** Stored state that can keep ribo from starting; offered to be cleared on errors */
const STORED_KEYS = ['ribo.autosave', 'ribo.layout']

const escape = (text: string) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack && !error.stack.startsWith(error.message) ? `${error.message}\n${error.stack}` : (error.stack ?? error.message)
  return String(error)
}

export class BootScreen {
  private readonly root = document.getElementById('ribo-boot')
  private readonly states = new Map<string, 'waiting' | 'loading' | 'active' | 'error'>()
  private readonly errors: BootError[] = []
  private status = 'Starte …'
  private finished = false

  constructor() {
    ;(window as { riboBootReady?: boolean }).riboBootReady = true
    window.addEventListener('error', this.onWindowError)
    window.addEventListener('unhandledrejection', this.onRejection)
  }

  /** The modules that will load, in order */
  expect(moduleIds: string[]): void {
    for (const id of moduleIds) if (!this.states.has(id)) this.states.set(id, 'waiting')
    this.render()
  }

  setStatus(text: string): void {
    this.status = text
    this.render()
  }

  readonly onModuleEvent = (event: ModuleEvent): void => {
    if (event.type === 'loading' || event.type === 'activating') {
      this.states.set(event.moduleId, 'loading')
      this.status = `${event.type === 'loading' ? 'Lade' : 'Starte'} ${event.moduleId} …`
    } else if (event.type === 'activated') {
      this.states.set(event.moduleId, 'active')
    } else if (event.type === 'error' || event.type === 'unsatisfied') {
      this.states.set(event.moduleId, 'error')
      this.push({ source: event.moduleId, message: event.error ? describe(event.error) : 'Benötigte Dienste fehlen' })
    }
    this.render()
  }

  fail(source: string, error: unknown): void {
    this.push({ source, message: describe(error) })
    this.render()
  }

  /** One entry per error: a failing module is reported again by each module that needs it */
  private push(error: BootError): void {
    const first = error.message.split('\n')[0]
    if (this.errors.some((e) => e.message.split('\n')[0] === first)) return
    this.errors.push(error)
  }

  /** Startup is over: fade out, unless something went wrong */
  done(): void {
    this.finished = true
    if (this.errors.length) {
      this.status = 'Gestartet, aber mit Fehlern'
      this.render()
      return
    }
    this.hide()
  }

  private readonly onWindowError = (event: ErrorEvent) => this.fail('Laufzeit', event.error ?? event.message)
  private readonly onRejection = (event: PromiseRejectionEvent) => this.fail('Laufzeit', event.reason)

  private hide(): void {
    window.removeEventListener('error', this.onWindowError)
    window.removeEventListener('unhandledrejection', this.onRejection)
    const root = this.root
    if (!root) return
    root.style.opacity = '0'
    root.style.pointerEvents = 'none'
    setTimeout(() => root.remove(), 400)
  }

  private render(): void {
    const root = this.root
    if (!root?.isConnected) return
    const total = this.states.size
    const done = [...this.states.values()].filter((s) => s === 'active' || s === 'error').length
    root.classList.toggle('failed', this.errors.length > 0)
    const bar = root.querySelector<HTMLElement>('.bar div')
    if (bar) bar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`
    const status = root.querySelector('.status')
    if (status) status.textContent = total ? `${done}/${total} Module · ${this.status}` : this.status
    const modules = root.querySelector('.modules')
    if (modules) modules.innerHTML = [...this.states].map(([id, state]) => `<span class="${state}">${escape(id.replace(/^ribo-/, ''))}</span>`).join('')

    root.querySelector('.errors')?.remove()
    if (!this.errors.length) return
    const box = document.createElement('div')
    box.className = 'errors'
    // The dev server rebuilt its modules while they were being loaded: a reload is all it takes
    const stale = this.errors.some((e) => /Failed to fetch dynamically imported module|Outdated Optimize Dep|error loading dynamically imported module/i.test(e.message))
    box.innerHTML = `
      <strong>${this.errors.length} Fehler beim Start</strong>
      ${stale ? '<p>Module konnten nicht geladen werden – meist hat der Dev-Server gerade neu übersetzt. Neu laden hilft; sonst den Dev-Server neu starten.</p>' : ''}
      ${this.errors.map((e) => `<div><b>${escape(e.source)}</b><pre>${escape(e.message.slice(0, 4000))}</pre></div>`).join('')}
      <div class="actions">
        <button data-action="reload">Neu laden</button>
        <button data-action="continue" ${this.finished ? '' : 'disabled'}>Trotzdem fortfahren</button>
        <button data-action="reset">Gespeicherten Stand verwerfen und neu laden</button>
        <button data-action="copy">Fehler kopieren</button>
      </div>`
    box.querySelector('[data-action="reload"]')?.addEventListener('click', () => window.location.reload())
    box.querySelector('[data-action="continue"]')?.addEventListener('click', () => this.hide())
    box.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      if (!window.confirm('Den im Browser gespeicherten Stand (Design und Fensteranordnung) verwerfen? Gespeicherte Dateien bleiben unberührt.')) return
      for (const key of STORED_KEYS) {
        try {
          localStorage.removeItem(key)
        } catch {
          // Storage blocked: nothing stored to discard
        }
      }
      window.location.reload()
    })
    box.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.errors.map((e) => `${e.source}: ${e.message}`).join('\n\n'))
    })
    root.appendChild(box)
  }
}
