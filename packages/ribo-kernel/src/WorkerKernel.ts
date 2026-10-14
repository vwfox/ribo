import type { BuildPlan, BuildResult, ExportFormat, KernelService } from 'ribo-contracts'
import type { KernelRequest, KernelResponse } from './protocol'

/** Omit that keeps the union apart, so each request keeps its own fields */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

type Pending = { resolve: (response: KernelResponse) => void; reject: (error: Error) => void }

/** Kernel service backed by the kernel worker. */
export class WorkerKernel implements KernelService {
  readonly ready: Promise<void>
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(private readonly worker: Worker) {
    let resolveReady!: () => void
    let rejectReady!: (error: Error) => void
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })

    worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      const response = event.data
      if (response.type === 'ready') return resolveReady()
      if (response.type === 'failed') return rejectReady(new Error(response.message))
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.type === 'error') pending.reject(new Error(response.message))
      else pending.resolve(response)
    }
    worker.onerror = (event) => rejectReady(new Error(event.message || 'Kernel-Worker konnte nicht starten'))
  }

  async build(plan: BuildPlan): Promise<BuildResult> {
    const response = await this.request({ type: 'build', plan })
    if (response.type !== 'built') throw new Error(`Unexpected kernel response '${response.type}'`)
    return { bodies: response.bodies, problems: response.problems, duration: response.duration }
  }

  async export(plan: BuildPlan, format: ExportFormat): Promise<Blob> {
    const response = await this.request({ type: 'export', plan, format })
    if (response.type !== 'exported') throw new Error(`Unexpected kernel response '${response.type}'`)
    return response.blob
  }

  dispose(): void {
    this.worker.terminate()
    for (const pending of this.pending.values()) pending.reject(new Error('Kernel beendet'))
    this.pending.clear()
  }

  private request(message: WithoutId<KernelRequest>): Promise<KernelResponse> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...message, id } as KernelRequest)
    })
  }
}
