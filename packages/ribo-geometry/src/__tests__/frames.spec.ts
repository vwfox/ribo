import { describe, expect, it } from 'vitest'
import { frameFromNormal, frameToWorld, offsetFrame, originFrame, tiltFrame, worldToFrame } from '../index'

const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

describe('frames', () => {
  it('places origin planes with an offset along their normal', () => {
    expect(frameToWorld(originFrame('XY', 5), [1, 2])).toEqual([1, 2, 5])
    expect(frameToWorld(originFrame('XZ', 5), [1, 2])).toEqual([1, -5, 2])
    expect(frameToWorld(originFrame('YZ', 5), [1, 2])).toEqual([5, 1, 2])
  })

  it('round-trips between sketch and world coordinates', () => {
    const frame = offsetFrame(frameFromNormal([1, 2, 3], [1, 1, 1]), 4)
    const [u, v] = worldToFrame(frame, frameToWorld(frame, [7, -3]))
    expect(u).toBeCloseTo(7)
    expect(v).toBeCloseTo(-3)
  })

  it('builds right-handed orthonormal frames from any normal', () => {
    for (const normal of [
      [0, 0, 1],
      [1, 0, 0],
      [1, 1, 1],
      [0.2, -0.9, 0.1],
    ] as [number, number, number][]) {
      const f = frameFromNormal([0, 0, 0], normal)
      expect(dot(f.x, f.y)).toBeCloseTo(0)
      expect(dot(f.x, f.normal)).toBeCloseTo(0)
      expect(dot(f.y, f.normal)).toBeCloseTo(0)
      expect(dot(f.normal, normal) / Math.hypot(...normal)).toBeCloseTo(1)
    }
  })

  it('tilts around its own axes', () => {
    const tilted = tiltFrame(originFrame('XY'), 'X', 90)
    expect(tilted.normal[1]).toBeCloseTo(-1)
    expect(tilted.y[2]).toBeCloseTo(1)
  })
})
