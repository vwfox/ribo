import { describe, expect, it } from 'vitest'
import type { BodyMesh } from 'ribo-contracts'
import { analyse } from '../analysis'
import { DEFAULT_SETTINGS } from '../settings'

/** An axis-aligned box as the kernel would mesh it, outward winding */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BodyMesh {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]
  const quads = [
    [0, 3, 2, 1], // bottom, facing -z
    [4, 5, 6, 7], // top
    [0, 1, 5, 4], // front, -y
    [2, 3, 7, 6], // back
    [1, 2, 6, 5], // right
    [3, 0, 4, 7], // left
  ]
  const triangles = quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!])
  return {
    vertices: new Float32Array(v.flat()),
    normals: new Float32Array(24),
    triangles: new Uint32Array(triangles),
    edges: new Float32Array(),
    edgeGroups: [],
    bounds: [x0, y0, z0, x1, y1, z1],
    volume: (x1 - x0) * (y1 - y0) * (z1 - z0),
    faces: [],
  }
}

describe('analyse', () => {
  it('reports size, fit and material of a box on the bed', () => {
    const report = analyse([box(0, 0, 0, 40, 20, 10)], DEFAULT_SETTINGS)
    expect(report.size).toEqual([40, 20, 10])
    expect(report.fits).toBe(true)
    expect(report.contact).toBeCloseTo(800)
    expect(report.overhangs.area).toBe(0)
    expect(report.thin.area).toBe(0)
    expect(report.weight).toBeCloseTo(8 * 1.24)
  })

  it('flags the underside of a floating box as overhang', () => {
    const report = analyse([box(0, 0, 0, 10, 10, 10), box(-10, -10, 10, 20, 20, 12)], DEFAULT_SETTINGS)
    // The plate's underside lies above the bed
    expect(report.overhangs.area).toBeCloseTo(900)
  })

  it('flags walls thinner than the minimum', () => {
    const report = analyse([box(0, 0, 0, 40, 20, 0.5)], DEFAULT_SETTINGS)
    expect(report.thin.thinnest).toBeCloseTo(0.5)
    expect(report.thin.area).toBeGreaterThan(1500)
  })

  it('knows when a part fits only turned', () => {
    const report = analyse([box(0, 0, 0, 200, 240, 5)], { ...DEFAULT_SETTINGS, bed: [250, 210, 220] })
    expect(report.fits).toBe(true)
    expect(report.fitsRotated).toBe(true)
  })

  it('knows when a part does not fit', () => {
    expect(analyse([box(0, 0, 0, 300, 30, 5)], DEFAULT_SETTINGS).fits).toBe(false)
  })
})
