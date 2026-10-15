/**
 * Turns a design into a build plan: every expression evaluated, every
 * reference resolved, every sketch reduced to its curves and regions.
 * Problems are collected per feature; a feature with a problem is left out.
 */

import {
  isArc,
  isChamfer,
  isCircle,
  isExtrude,
  isConstructionPlane,
  isFillet,
  isHole,
  isShell,
  isLine,
  isProfileFeature,
  isRevolve,
  isSketch,
  type ConstructionPlane,
  type Design,
  type Feature,
  type Parameter,
  type ProfileFeature,
  type Sketch,
  type SketchCircle,
} from 'ribo-model'
import type { BuildPlan, FeatureProblem, Frame, HoleFeature, ModifierFeature, PlanCurve, PlanFeature, PlanOperation, PlanRegion, Vec2, Vec3 } from 'ribo-contracts'
import { evaluateExpression, type Scope } from './expression'
import { findRegions, frameFromNormal, offsetFrame, originFrame, regionAt, tiltFrame } from 'ribo-geometry'

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

type Evaluate = (label: string, source: string | undefined) => number

/** The coordinate system of a construction plane, following its references */
export function constructionFrame(plane: ConstructionPlane, evaluate: Evaluate, seen = new Set<ConstructionPlane>()): Frame {
  if (seen.has(plane)) throw new Error('Die Ebenen beziehen sich im Kreis aufeinander')
  seen.add(plane)
  let base: Frame
  switch (plane.base) {
    case 'Face':
      base = frameFromNormal([plane.originX, plane.originY, plane.originZ], [plane.normalX, plane.normalY, plane.normalZ])
      break
    case 'Plane':
      if (!plane.reference) throw new Error('Keine Bezugsebene gewählt')
      base = constructionFrame(plane.reference, evaluate, seen)
      break
    default:
      base = originFrame(plane.base ?? 'XY')
  }
  const tilted = tiltFrame(base, plane.tiltAxis ?? 'X', evaluate('Winkel', plane.angle))
  return offsetFrame(tilted, evaluate('Versatz', plane.offset))
}

/** The coordinate system of a sketch: its construction plane, or an origin plane, plus its offset */
export function sketchFrame(sketch: Sketch, evaluate: Evaluate): Frame {
  const offset = evaluate('Versatz', sketch.offset)
  if (sketch.reference) return offsetFrame(constructionFrame(sketch.reference, evaluate), offset)
  return originFrame(sketch.plane ?? 'XY', offset)
}

/** Where a hole feature drills: free points (on no curve) and circle centres */
export function holeCenters(sketch: Sketch): Vec2[] {
  const curves = sketch.curves.toArray()
  const onCurves = new Set(curves.flatMap((c) => (isLine(c) ? [c.start, c.end] : isArc(c) ? [c.center, c.start, c.end] : [])))
  const free = sketch.points.toArray().filter((p) => !p.origin && !onCurves.has(p) && !curves.some((c) => isCircle(c) && c.center === p))
  const centres = curves.filter((c): c is SketchCircle => isCircle(c) && !c.construction).map((c) => c.center)
  return [...free, ...centres].map((p): Vec2 => [p.x, p.y])
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
  const planned: (PlanFeature | ModifierFeature | HoleFeature)[] = []
  const problems: FeatureProblem[] = []
  /** Construction planes that made it into the plan */
  const planes = new Set<ConstructionPlane>()
  /** Sketches that made it into the plan */
  const sketchPlans = new Map<Sketch, Extract<PlanFeature, { kind: 'sketch' }>>()

  features.forEach((feature, index) => {
    if (feature.suppressed || isRolledBack(design, feature, index)) return
    const evaluate: Evaluate = (label, source) => {
      try {
        return evaluateExpression(source ?? '', scope)
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`)
      }
    }
    try {
      if (isConstructionPlane(feature)) {
        if (feature.base === 'Plane' && feature.reference && !planes.has(feature.reference)) {
          throw new Error('Die Bezugsebene ist unterdrückt, fehlerhaft oder liegt später')
        }
        planned.push({ kind: 'plane', index, frame: constructionFrame(feature, evaluate) })
        planes.add(feature)
        return
      }
      if (isSketch(feature)) {
        if (feature.reference && !planes.has(feature.reference)) {
          throw new Error('Die Ebene der Skizze ist unterdrückt, fehlerhaft oder liegt später')
        }
        const curves = sketchCurves(feature)
        const sketchPlan = {
          kind: 'sketch' as const,
          index,
          frame: sketchFrame(feature, evaluate),
          curves,
          regions: sketchRegions(curves),
        }
        planned.push(sketchPlan)
        sketchPlans.set(feature, sketchPlan)
        return
      }
      if (isFillet(feature) || isChamfer(feature)) {
        const edges = feature.edges.toArray().map((e): Vec3 => [e.x, e.y, e.z])
        if (edges.length === 0) throw new Error('Keine Kante gewählt – Kanten im Ansichtsfenster anklicken')
        if (isFillet(feature)) planned.push({ kind: 'fillet', index, edges, radius: evaluate('Radius', feature.radius) })
        else planned.push({ kind: 'chamfer', index, edges, distance: evaluate('Abstand', feature.distance) })
        return
      }
      if (isHole(feature)) {
        const sketch = feature.sketch
        if (!sketch) throw new Error('Keine Skizze gewählt')
        const sketchPlan = sketchPlans.get(sketch)
        if (!sketchPlan) throw new Error('Die Skizze ist unterdrückt, fehlerhaft oder liegt später')
        const centers = holeCenters(sketch)
        if (centers.length === 0) throw new Error('Die Skizze enthält keine Punkte oder Kreise für Bohrungen')
        const diameter = evaluate('Durchmesser', feature.diameter)
        if (diameter <= 0) throw new Error('Durchmesser muss größer als 0 sein')
        const depth = (feature.depth ?? '').trim() ? evaluate('Tiefe', feature.depth) : undefined
        const type = feature.holeType ?? 'Simple'
        const headDiameter = type === 'Simple' ? diameter : evaluate('Kopfdurchmesser', feature.headDiameter)
        if (type !== 'Simple' && headDiameter <= diameter) throw new Error('Kopfdurchmesser muss größer als der Bohrungsdurchmesser sein')
        planned.push({
          kind: 'hole',
          index,
          sketch: sketchPlan.index,
          centers,
          type,
          diameter,
          depth,
          headDiameter,
          headDepth: type === 'Counterbore' ? evaluate('Senktiefe', feature.headDepth) : 0,
          countersinkAngle: type === 'Countersink' ? evaluate('Senkwinkel', feature.countersinkAngle) : 90,
          reversed: feature.reversed ?? false,
        })
        return
      }
      if (isShell(feature)) {
        const faces = feature.faces.toArray().map((f): Vec3 => [f.x, f.y, f.z])
        if (faces.length === 0) throw new Error('Keine Fläche gewählt – zu öffnende Flächen im Ansichtsfenster anklicken')
        const depth = (feature.depth ?? '').trim() ? evaluate('Tiefe', feature.depth) : undefined
        if (depth !== undefined && depth <= 0) throw new Error('Tiefe muss größer als 0 sein')
        planned.push({ kind: 'shell', index, faces, thickness: evaluate('Wandstärke', feature.thickness), depth })
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

  return { plan: { features: planned.map((f) => ({ ...f, component: buildComponent(design, features[f.index]!) })) }, problems }
}

/**
 * Each component has its own timeline marker - the design itself (and the
 * joints) the design's. A feature is rolled back when it lies at or after the
 * marker of the component it lives in.
 */
export function isRolledBack(design: Design, feature: Feature, index: number): boolean {
  const marker = (feature.component ?? design).rollback ?? -1
  return marker >= 0 && index >= marker
}

/** Index of a component in the plan: 0 is the design itself, i + 1 its i-th component */
export function componentIndex(design: Design, component: { eContainer(): unknown } | undefined | null): number {
  if (!component) return 0
  return design.components.indexOf(component as never) + 1
}

/**
 * The component a feature builds in. Features working on a sketch build where
 * the sketch is, so the sketch's coordinates are the bodies' coordinates.
 */
export function buildComponent(design: Design, feature: Feature): number {
  const sketch = isProfileFeature(feature) || isHole(feature) ? feature.sketch : undefined
  return componentIndex(design, (sketch ?? feature).component)
}
