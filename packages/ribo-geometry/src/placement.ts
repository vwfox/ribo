/**
 * Rigid placements as 4×4 matrices (column-major, like three.js).
 */

import type { Matrix, Vec3 } from 'ribo-contracts/geometry'

export const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** Inverse of a rigid matrix: transposed rotation, back-rotated translation */
export function invert(m: Matrix): Matrix {
  const r = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!]
  const t: Vec3 = [m[12]!, m[13]!, m[14]!]
  // Rows of R become columns
  const out: Matrix = [r[0]!, r[3]!, r[6]!, 0, r[1]!, r[4]!, r[7]!, 0, r[2]!, r[5]!, r[8]!, 0, 0, 0, 0, 1]
  out[12] = -(out[0]! * t[0] + out[4]! * t[1] + out[8]! * t[2])
  out[13] = -(out[1]! * t[0] + out[5]! * t[1] + out[9]! * t[2])
  out[14] = -(out[2]! * t[0] + out[6]! * t[1] + out[10]! * t[2])
  return out
}

export function translation([x, y, z]: Vec3): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

/** Rotation about a principal axis, degrees */
export function rotation(axis: 'X' | 'Y' | 'Z', degrees: number): Matrix {
  const a = (degrees * Math.PI) / 180
  const [c, s] = [Math.cos(a), Math.sin(a)]
  if (axis === 'X') return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
  if (axis === 'Y') return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Position plus rotation about X, then Y, then Z (degrees) */
export function placement(position: Vec3, rotationDegrees: Vec3): Matrix {
  const r = multiply(rotation('Z', rotationDegrees[2]), multiply(rotation('Y', rotationDegrees[1]), rotation('X', rotationDegrees[0])))
  return multiply(translation(position), r)
}

/** The frame (origin, x and z axes) as a matrix mapping frame coordinates to the space it is given in */
export function frameMatrix(origin: Vec3, zAxis: Vec3, xAxis: Vec3): Matrix {
  const normalize = (v: Vec3): Vec3 => {
    const l = Math.hypot(...v) || 1
    return [v[0] / l, v[1] / l, v[2] / l]
  }
  const z = normalize(zAxis)
  // Make x perpendicular to z even when given slightly off
  const d = xAxis[0] * z[0] + xAxis[1] * z[1] + xAxis[2] * z[2]
  let x = normalize([xAxis[0] - d * z[0], xAxis[1] - d * z[1], xAxis[2] - d * z[2]])
  if (!Number.isFinite(x[0]) || Math.hypot(...x) < 0.5) {
    // No usable x given: world X projected onto the plane, or world Y where X is the axis
    x = Math.abs(z[0]) < 0.9 ? normalize([1 - z[0] * z[0], -z[0] * z[1], -z[0] * z[2]]) : normalize([-z[1] * z[0], 1 - z[1] * z[1], -z[1] * z[2]])
  }
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, origin[0], origin[1], origin[2], 1]
}

export function applyPoint(m: Matrix, [x, y, z]: Vec3): Vec3 {
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!]
}

export function applyDirection(m: Matrix, [x, y, z]: Vec3): Vec3 {
  return [m[0]! * x + m[4]! * y + m[8]! * z, m[1]! * x + m[5]! * y + m[9]! * z, m[2]! * x + m[6]! * y + m[10]! * z]
}

export function isIdentity(m: Matrix): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]!) < 1e-12)
}
