/** Messages between the kernel service and its worker. */

import type { BodyMesh, BuildPlan, ExportFormat, FeatureProblem, Matrix } from 'ribo-contracts/geometry'

export type KernelRequest =
  | { id: number; type: 'build'; plan: BuildPlan }
  | { id: number; type: 'export'; plan: BuildPlan; format: ExportFormat; title?: string; placements?: Matrix[] }

export type KernelResponse =
  | { id: 0; type: 'ready' }
  | { id: 0; type: 'failed'; message: string }
  | { id: number; type: 'built'; bodies: BodyMesh[]; problems: FeatureProblem[]; duration: number }
  | { id: number; type: 'exported'; blob: Blob }
  | { id: number; type: 'error'; message: string }
