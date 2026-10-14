/**
 * Turns a design into a build plan: every expression evaluated, every
 * reference resolved, every sketch reduced to its curves and regions.
 * Problems are collected per feature; a feature with a problem is left out.
 */

import {
  isArc,
  isCircle,
  isExtrude,
  isLine,
  isProfileFeature,
  isRevolve,
  isSketch,
  type Design,
  type Parameter,
  type ProfileFeature,
  type Sketch,
} from 'ribo-model'
import type { BuildPlan, FeatureProblem, PlanCurve, PlanFeature, PlanOperation, PlanRegion, Vec2 } from 'ribo-contracts'
import { evaluateExpression, type Scope } from './expression'
import { findRegions, regionAt } from 'ribo-geometry'

/**
 * Evaluates the parameters in declaration order. A parameter can use the ones
 * declared before it, which rules out cycles.
 */
export function evaluateParameters(design: Design): Map<Parameter, number | Error> {
  const values = new Map<Parameter, number | Error>()
  const byName = new Map<string, number>()
  for (const parameter of design.parameters.toArray()) {
    try {
      const value = evaluateExpression(parameter.expression ?? '', (name) => byName.get(name))
      values.set(parameter, value)
      if (parameter.name) byName.set(parameter.name, value)
    } catch (error) {
      values.set(parameter, error as Error)
    }
  }
  return values
}

export function scopeOf(values: Map<Parameter, number | Error>): Scope {
  const byName = new Map<string, number>()
  for (const [parameter, value] of values) {
    if (parameter.name && typeof value === 'number') byName.set(parameter.name, value)
  }
  return (name) => byName.get(name)
}

/** The sketch's curves as plain data, construction curves included */
export function sketchCurves(sketch: Sketch): PlanCurve[] {
  const curves: PlanCurve[] = []
  for (const curve of sketch.curves.toArray()) {
    const construction = curve.construction ?? false
    if (isLine(curve) && curve.start && curve.end) {
      curves.push({ kind: 'line', from: [curve.start.x, curve.start.y], to: [curve.end.x, curve.end.y], construction })
    } else if (isCircle(curve) && curve.center) {
      curves.push({ kind: 'circle', center: [curve.center.x, curve.center.y], radius: curve.radius, construction })
    } else if (isArc(curve) && curve.center && curve.start && curve.end) {
      const center: Vec2 = [curve.center.x, curve.center.y]
      curves.push({
        kind: 'arc',
        center,
        radius: Math.hypot(curve.start.x - center[0], curve.start.y - center[1]),
        from: [curve.start.x, curve.start.y],
        to: [curve.end.x, curve.end.y],
        construction,
      })
    }
  }
  return curves
}

/** Regions of the sketch, from its non-construction curves */
export function sketchRegions(curves: PlanCurve[]): PlanRegion[] {
  return findRegions(curves.filter((c) => !c.construction))
}

/** The regions a profile feature uses: the picked ones, or by default those at even depth */
export function selectedRegions(feature: ProfileFeature, regions: PlanRegion[]): number[] {
  const picks = feature.profiles.toArray()
  if (picks.length === 0) {
    return regions.flatMap((region, i) => (region.depth % 2 === 0 ? [i] : []))
  }
  const indexes = picks.map((pick) => regionAt(regions, [pick.u, pick.v]))
  if (indexes.some((i) => i < 0)) throw new Error('Ein gewähltes Profil existiert nicht mehr')
  return [...new Set(indexes)]
}

export interface CompiledPlan {
  plan: BuildPlan
  problems: FeatureProblem[]
}

export function compilePlan(design: Design): CompiledPlan {
  const scope = scopeOf(evaluateParameters(design))
  const features = design.features.toArray()
  const rollback = design.rollback ?? -1
  const end = rollback >= 0 ? Math.min(rollback, features.length) : features.length
  const planned: PlanFeature[] = []
  const problems: FeatureProblem[] = []
  /** Sketches that made it into the plan */
  const sketchPlans = new Map<Sketch, Extract<PlanFeature, { kind: 'sketch' }>>()

  features.slice(0, end).forEach((feature, index) => {
    if (feature.suppressed) return
    const evaluate = (label: string, source: string | undefined) => {
      try {
        return evaluateExpression(source ?? '', scope)
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`)
      }
    }
    try {
      if (isSketch(feature)) {
        const curves = sketchCurves(feature)
        const sketchPlan = {
          kind: 'sketch' as const,
          index,
          plane: feature.plane ?? 'XY',
          offset: evaluate('Versatz', feature.offset),
          curves,
          regions: sketchRegions(curves),
        }
        planned.push(sketchPlan)
        sketchPlans.set(feature, sketchPlan)
        return
      }
      if (!isProfileFeature(feature)) return

      const sketch = feature.sketch
      if (!sketch) throw new Error('Keine Skizze gewählt')
      const sketchPlan = sketchPlans.get(sketch)
      if (!sketchPlan) {
        throw new Error(
          features.indexOf(sketch) > index ? 'Die Skizze liegt in der Zeitleiste später' : 'Die Skizze ist unterdrückt oder fehlerhaft',
        )
      }
      if (sketchPlan.regions.length === 0) throw new Error('Die Skizze enthält kein geschlossenes Profil')
      const profiles = selectedRegions(feature, sketchPlan.regions)
      const operation: PlanOperation = feature.operation ?? 'NewBody'

      if (isExtrude(feature)) {
        planned.push({
          kind: 'extrude',
          index,
          sketch: sketchPlan.index,
          profiles,
          operation,
          distance: evaluate('Abstand', feature.distance),
          direction: feature.direction ?? 'OneSide',
        })
      } else if (isRevolve(feature)) {
        const line = feature.axisLine
        let axis: { origin: Vec2; direction: Vec2 }
        if (line?.start && line.end) {
          axis = { origin: [line.start.x, line.start.y], direction: [line.end.x - line.start.x, line.end.y - line.start.y] }
        } else {
          axis = { origin: [0, 0], direction: (feature.axis ?? 'Y') === 'X' ? [1, 0] : [0, 1] }
        }
        planned.push({ kind: 'revolve', index, sketch: sketchPlan.index, profiles, operation, axis, angle: evaluate('Winkel', feature.angle) })
      }
    } catch (error) {
      problems.push({ index, message: (error as Error).message })
    }
  })

  return { plan: { features: planned }, problems }
}
