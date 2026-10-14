/**
 * 3MF export: the format slicers prefer - units, several bodies as separate
 * objects, and a closed mesh with shared vertices instead of STL's loose triangles.
 */

import { zipSync, strToU8 } from 'fflate'

export interface MeshData {
  name: string
  vertices: number[]
  triangles: number[]
}

/** Vertices closer than this are one vertex, mm */
const WELD = 1e-4

/** Merges the duplicate vertices replicad emits per face, so the mesh is closed */
function weld(mesh: MeshData): { vertices: number[]; triangles: number[] } {
  const index = new Map<string, number>()
  const vertices: number[] = []
  const remap: number[] = []
  for (let i = 0; i < mesh.vertices.length / 3; i++) {
    const [x, y, z] = [mesh.vertices[i * 3]!, mesh.vertices[i * 3 + 1]!, mesh.vertices[i * 3 + 2]!]
    const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`
    let target = index.get(key)
    if (target === undefined) {
      target = vertices.length / 3
      index.set(key, target)
      vertices.push(x, y, z)
    }
    remap.push(target)
  }
  const triangles: number[] = []
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [a, b, c] = [remap[mesh.triangles[i]!]!, remap[mesh.triangles[i + 1]!]!, remap[mesh.triangles[i + 2]!]!]
    // Welding can collapse slivers into lines; those are no triangles
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c)
  }
  return { vertices, triangles }
}

const escape = (text: string) => text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!)
const num = (value: number) => Number(value.toFixed(5)).toString()

export function build3mf(title: string, meshes: MeshData[]): Uint8Array {
  const objects: string[] = []
  const items: string[] = []
  meshes.forEach((mesh, i) => {
    const { vertices, triangles } = weld(mesh)
    const v: string[] = []
    for (let k = 0; k < vertices.length; k += 3) v.push(`<vertex x="${num(vertices[k]!)}" y="${num(vertices[k + 1]!)}" z="${num(vertices[k + 2]!)}"/>`)
    const t: string[] = []
    for (let k = 0; k < triangles.length; k += 3) t.push(`<triangle v1="${triangles[k]}" v2="${triangles[k + 1]}" v3="${triangles[k + 2]}"/>`)
    objects.push(
      `<object id="${i + 1}" type="model" name="${escape(mesh.name)}"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`,
    )
    items.push(`<item objectid="${i + 1}"/>`)
  })

  const model =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<metadata name="Title">${escape(title)}</metadata><metadata name="Application">ribo</metadata>` +
    `<resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>'

  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>'

  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(model),
  })
}
