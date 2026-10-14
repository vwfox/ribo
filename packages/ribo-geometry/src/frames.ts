/**
 * Arithmetic on sketch coordinate systems (frames).
 */

import { PLANE_BASIS, type Frame, type PlanPlane, type Vec2, type Vec3 } from 'ribo-contracts/geometry'

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1))

/** An origin plane moved along its normal */
export function originFrame(plane: PlanPlane, offset = 0): Frame {
  const { x, y, normal } = PLANE_BASIS[plane]
  return { origin: scale([...normal], offset), x: [...x], y: [...y], normal: [...normal] }
}

/**
 * A frame on a plane given by a point and normal, e.g. a picked face. Its x
 * axis is the world X axis projected onto the plane - or world Y where X is
 * the normal - so sketches on similar faces line up the same way.
 */
export function frameFromNormal(origin: Vec3, normal: Vec3): Frame {
  const n = normalize(normal)
  const reference: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const x = normalize(add(reference, scale(n, -dot(reference, n))))
  return { origin: [...origin], x, y: cross(n, x), normal: n }
}

export function offsetFrame(frame: Frame, distance: number): Frame {
  return { ...frame, origin: add(frame.origin, scale(frame.normal, distance)) }
}

/** Tilts a frame by an angle (degrees) around its own x or y axis through its origin */
export function tiltFrame(frame: Frame, axis: 'X' | 'Y', degrees: number): Frame {
  if (!degrees) return frame
  const a = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.cos(a), Math.sin(a)]
  if (axis === 'X') {
    // Rotating y towards the normal
    const y = add(scale(frame.y, cos), scale(frame.normal, sin))
    return { ...frame, y, normal: cross(frame.x, y) }
  }
  const x = add(scale(frame.x, cos), scale(frame.normal, -sin))
  return { ...frame, x, normal: cross(x, frame.y) }
}

export function frameToWorld(frame: Frame, [u, v]: Vec2): Vec3 {
  return add(frame.origin, add(scale(frame.x, u), scale(frame.y, v)))
}

export function worldToFrame(frame: Frame, p: Vec3): Vec2 {
  const d: Vec3 = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]]
  return [dot(d, frame.x), dot(d, frame.y)]
}

/** A direction given in sketch coordinates, in world coordinates */
export function frameDirection(frame: Frame, [du, dv]: Vec2): Vec3 {
  return add(scale(frame.x, du), scale(frame.y, dv))
}
