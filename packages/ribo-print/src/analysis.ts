/**
 * Printability checks on the body meshes the kernel produced.
 */

import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { BodyMesh, Vec3 } from 'ribo-contracts'
import { MATERIALS, type PrintSettings } from './settings'

/** Upper bound of triangles probed for wall thickness; larger meshes are sampled */
const MAX_THICKNESS_PROBES = 40000
/** A hit counts as the opposite wall only when its face points back towards the ray */
const OPPOSITE_FACING = -0.3
/** Triangles this close to the lowest point lie on the bed, mm */
const BED_CONTACT = 0.01

export interface Marked {
  /** Total area, mm² */
  area: number
  /** Triangle corners for highlighting */
  positions: Float32Array
}

export interface PrintReport {
  bodies: number
  /** Bounding box size, mm */
  size: Vec3
  /** Lowest z; slicers put the part on the bed anyway */
  minZ: number
  fits: boolean
  /** Fits only when turned by 90° on the bed */
  fitsRotated: boolean
  /** mm³ */
  volume: number
  /** g, solid */
  weight: number
  /** m of filament, solid */
  filamentLength: number
  /** Area touching the bed, mm² */
  contact: number
  overhangs: Marked
  thin: Marked & { thinnest: number | undefined }
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2
}

function collect(list: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) {
  list.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
}

export function analyse(bodies: BodyMesh[], settings: PrintSettings): PrintReport {
  const box = new THREE.Box3()
  let volume = 0
  for (const body of bodies) {
    const [x0, y0, z0, x1, y1, z1] = body.bounds
    box.union(new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)))
    volume += body.volume
  }
  const size: Vec3 = box.isEmpty() ? [0, 0, 0] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
  const minZ = box.isEmpty() ? 0 : box.min.z
  const [bx, by, bz] = settings.bed
  const fitsFlat = size[0] <= bx && size[1] <= by && size[2] <= bz
  const fitsTurned = size[1] <= bx && size[0] <= by && size[2] <= bz

  const density = MATERIALS.find((m) => m.id === settings.material)?.density ?? 1.24
  const filamentArea = Math.PI * (settings.filament / 2) ** 2

  // A face is an overhang when its normal points down more steeply than the
  // angle allows: 0° is a vertical wall, 90° a ceiling
  const overhangLimit = -Math.sin((settings.overhangAngle * Math.PI) / 180)
  const overhang: number[] = []
  let overhangArea = 0
  let contact = 0
  const thin: number[] = []
  let thinArea = 0
  let thinnest: number | undefined

  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const ray = new THREE.Ray()

  for (const body of bodies) {
    const count = body.triangles.length / 3
    const vertex = (target: THREE.Vector3, i: number) => target.set(body.vertices[i * 3]!, body.vertices[i * 3 + 1]!, body.vertices[i * 3 + 2]!)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(body.vertices, 3))
    // A copy: MeshBVH sorts the index in place, and the body's own order is what its face ranges refer to
    geometry.setIndex(new THREE.BufferAttribute(body.triangles.slice(), 1))
    const bvh = new MeshBVH(geometry)
    const stride = Math.max(1, Math.ceil(count / MAX_THICKNESS_PROBES))

    for (let t = 0; t < count; t++) {
      vertex(a, body.triangles[t * 3]!)
      vertex(b, body.triangles[t * 3 + 1]!)
      vertex(c, body.triangles[t * 3 + 2]!)
      const area = triangleArea(a, b, c)
      if (area < 1e-9) continue
      normal.subVectors(b, a).cross(c.clone().sub(a)).normalize()

      const onBed = Math.max(a.z, b.z, c.z) - minZ < BED_CONTACT
      if (onBed && normal.z < -0.99) contact += area
      else if (normal.z < overhangLimit) {
        overhangArea += area
        collect(overhang, a, b, c)
      }

      if (t % stride !== 0) continue
      // Wall thickness: from the face centre straight inwards to the opposite wall
      const centre = new THREE.Vector3().add(a).add(b).add(c).divideScalar(3)
      ray.origin.copy(centre).addScaledVector(normal, -1e-4)
      ray.direction.copy(normal).negate()
      const hits = bvh.raycast(ray, THREE.DoubleSide)
      let distance: number | undefined
      for (const hit of hits) {
        if (hit.distance < 1e-5 || !hit.face) continue
        if (hit.face.normal.dot(normal) > OPPOSITE_FACING) continue
        if (distance === undefined || hit.distance < distance) distance = hit.distance
      }
      if (distance !== undefined && distance < settings.minWall) {
        thinArea += area
        collect(thin, a, b, c)
        thinnest = thinnest === undefined ? distance : Math.min(thinnest, distance)
      }
    }
    geometry.dispose()
  }

  return {
    bodies: bodies.length,
    size,
    minZ,
    fits: fitsFlat || fitsTurned,
    fitsRotated: !fitsFlat && fitsTurned,
    volume,
    weight: (volume / 1000) * density,
    filamentLength: volume / filamentArea / 1000,
    contact,
    overhangs: { area: overhangArea, positions: new Float32Array(overhang) },
    thin: { area: thinArea, positions: new Float32Array(thin), thinnest },
  }
}
