/**
 * ribo document module
 *
 * Holds the design being edited, solves its sketches and keeps the build
 * result in step with it.
 */

import type { ModuleContext } from '@eclipse-daanse/tsm'
import { DOCUMENT, KERNEL } from 'ribo-contracts'
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'
import { DesignDocument } from './DesignDocument'
import { SketchSolver } from './solver'

export { DESIGN_PROBLEM_INDEX } from './DesignDocument'

let document: DesignDocument | null = null

export async function activate(context: ModuleContext): Promise<void> {
  document = new DesignDocument(context.services.getRequired(KERNEL), SketchSolver.create(wasmUrl))
  context.services.register(DOCUMENT, document)
}

export async function deactivate(): Promise<void> {
  document?.dispose()
  document = null
}
