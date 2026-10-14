/**
 * Geometry kernel worker: loads OpenCascade once, then answers build and
 * export requests one at a time.
 */

import opencascade from 'replicad-opencascadejs'
import wasmUrl from 'replicad-opencascadejs/wasm?url'
import { setOC, type Shape3D } from 'replicad'
import { buildDesign, exportBodies, meshBody, messageOf } from './build'
import type { KernelRequest, KernelResponse } from './protocol'

const scope = self as unknown as DedicatedWorkerGlobalScope

const post = (response: KernelResponse, transfer: Transferable[] = []) => scope.postMessage(response, transfer)

const ready = opencascade({ locateFile: () => wasmUrl }).then(
  (oc) => {
    setOC(oc)
    post({ id: 0, type: 'ready' })
  },
  (error: unknown) => {
    post({ id: 0, type: 'failed', message: messageOf(error) })
    throw error
  },
)

function release(bodies: Shape3D[]) {
  for (const body of bodies) body.delete()
}

function handle(request: KernelRequest) {
  const started = performance.now()
  const { bodies, problems } = buildDesign(request.plan)
  try {
    if (request.type === 'export') {
      post({ id: request.id, type: 'exported', blob: exportBodies(bodies, request.format) })
      return
    }
    const meshes = bodies.map(meshBody)
    const transfer = meshes.flatMap((m) => [m.vertices.buffer, m.normals.buffer, m.triangles.buffer, m.edges.buffer])
    post({ id: request.id, type: 'built', bodies: meshes, problems, duration: performance.now() - started }, transfer)
  } finally {
    release(bodies)
  }
}

scope.onmessage = async (event: MessageEvent<KernelRequest>) => {
  const request = event.data
  try {
    await ready
    handle(request)
  } catch (error) {
    post({ id: request.id, type: 'error', message: messageOf(error) })
  }
}
