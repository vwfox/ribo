/**
 * ribo geometry kernel module
 *
 * Provides the kernel service. The geometry itself runs in a web worker so a
 * long boolean operation does not freeze the UI.
 */

import type { ModuleContext } from '@eclipse-daanse/tsm'
import { KERNEL } from 'ribo-contracts'
import { WorkerKernel } from './WorkerKernel'

let kernel: WorkerKernel | null = null

export async function activate(context: ModuleContext): Promise<void> {
  kernel = new WorkerKernel(new Worker(new URL('./kernel.worker.ts', import.meta.url), { type: 'module' }))
  kernel.ready.catch((error) => context.log.error('OpenCascade failed to load', error))
  context.services.register(KERNEL, kernel)
}

export async function deactivate(): Promise<void> {
  kernel?.dispose()
  kernel = null
}
