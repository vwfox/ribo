import { describe, expect, it } from 'vitest'
import type { PlanCurve, Vec2 } from 'ribo-contracts/geometry'
import { closestPoint, crossings, findRegions, regionAt } from '../index'

const line = (from: Vec2, to: Vec2): PlanCurve => ({ kind: 'line', from, to, construction: false })
const circle = (center: Vec2, radius: number): PlanCurve => ({ kind: 'circle', center, radius, construction: false })
const arc = (center: Vec2, from: Vec2, to: Vec2): PlanCurve => ({ kind: 'arc', center, radius: 0, from, to, construction: false })
const rect = (x0: number, y0: number, x1: number, y1: number) => [
  line([x0, y0], [x1, y0]),
  line([x1, y0], [x1, y1]),
  line([x1, y1], [x0, y1]),
  line([x0, y1], [x0, y0]),
]
const areas = (curves: PlanCurve[]) =>
  findRegions(curves)
    .map((r) => Math.round(r.area))
    .sort((a, b) => a - b)

describe('findRegions', () => {
  it('finds a rectangle', () => {
    expect(areas(rect(0, 0, 40, 30))).toEqual([1200])
  })

  it('makes an inner circle a hole and a region of its own', () => {
    const regions = findRegions([...rect(0, 0, 40, 30), circle([20, 15], 5)])
    expect(regions).toHaveLength(2)
    const ring = regions.find((r) => r.depth === 0)!
    expect(ring.holes).toHaveLength(1)
    expect(regions.find((r) => r.depth === 1)!.holes).toHaveLength(0)
  })

  it('splits overlapping rectangles into three regions', () => {
    expect(areas([...rect(0, 0, 20, 20), ...rect(10, 10, 30, 30)])).toEqual([100, 300, 300])
  })

  it('splits a circle crossed by a line', () => {
    expect(findRegions([circle([0, 0], 10), line([-20, 0], [20, 0])])).toHaveLength(2)
  })

  it('ignores open and dangling geometry', () => {
    expect(findRegions([line([0, 0], [10, 0]), line([10, 0], [10, 10])])).toHaveLength(0)
    expect(areas([...rect(0, 0, 20, 20), line([20, 20], [30, 30])])).toEqual([400])
  })

  it('closes a slot of lines and arcs', () => {
    const slot = [line([0, -5], [20, -5]), arc([20, 0], [20, -5], [20, 5]), line([20, 5], [0, 5]), arc([0, 0], [0, 5], [0, -5])]
    const [region] = findRegions(slot)
    expect(region!.area).toBeCloseTo(200 + Math.PI * 25, 0)
  })

  it('does not split parallel lines that do not touch', () => {
    const regions = findRegions([...rect(0, 0, 100, 100), ...rect(40, 40, 60, 60)])
    expect(regions.find((r) => r.depth === 0)!.outer).toHaveLength(4)
  })

  it('finds the innermost region at a point', () => {
    const regions = findRegions([...rect(0, 0, 100, 100), circle([50, 50], 30), ...rect(40, 40, 60, 60)])
    expect(regions[regionAt(regions, [50, 50])]!.depth).toBe(2)
    expect(regions[regionAt(regions, [5, 5])]!.depth).toBe(0)
    expect(regions[regionAt(regions, [50, 25])]!.depth).toBe(1)
    expect(regionAt(regions, [200, 200])).toBe(-1)
  })
})

describe('curve queries', () => {
  it('finds the closest point on a line', () => {
    const hit = closestPoint(line([0, 0], [10, 0]), [4, 3])!
    expect(hit.point).toEqual([4, 0])
    expect(hit.distance).toBeCloseTo(3)
  })

  it('lists where other curves cross a line, in order', () => {
    const result = crossings(line([0, 0], [10, 0]), [line([7, -1], [7, 1]), line([3, -1], [3, 1])])
    expect(result.map((c) => c.point[0])).toEqual([3, 7])
  })
})
