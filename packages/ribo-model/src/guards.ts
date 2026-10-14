/**
 * Type guards over the generated model, by EClass rather than by JS class, so
 * they hold for every instance the factory creates or a resource loads.
 */

import type { EClass, EObject } from '@emfts/core'
import { RiboPackage } from './generated/ribo/RiboPackage.js'
import type {
  Dimension,
  Extrude,
  Feature,
  GeometricConstraint,
  Parameter,
  ProfileFeature,
  Revolve,
  Sketch,
  SketchArc,
  SketchCircle,
  SketchConstraint,
  SketchCurve,
  SketchLine,
  SketchPoint,
} from './generated/ribo/index.js'

type Maybe = EObject | undefined | null

export function isKindOf(object: Maybe, eClass: EClass): boolean {
  if (!object) return false
  const actual = object.eClass()
  return actual === eClass || eClass.isSuperTypeOf(actual)
}

const L = () => RiboPackage.Literals

export const isFeature = (o: Maybe): o is Feature => isKindOf(o, L().FEATURE)
export const isSketch = (o: Maybe): o is Sketch => isKindOf(o, L().SKETCH)
export const isProfileFeature = (o: Maybe): o is ProfileFeature => isKindOf(o, L().PROFILE_FEATURE)
export const isExtrude = (o: Maybe): o is Extrude => isKindOf(o, L().EXTRUDE)
export const isRevolve = (o: Maybe): o is Revolve => isKindOf(o, L().REVOLVE)
export const isParameter = (o: Maybe): o is Parameter => isKindOf(o, L().PARAMETER)

export const isSketchPoint = (o: Maybe): o is SketchPoint => isKindOf(o, L().SKETCH_POINT)
export const isSketchCurve = (o: Maybe): o is SketchCurve => isKindOf(o, L().SKETCH_CURVE)
export const isLine = (o: Maybe): o is SketchLine => isKindOf(o, L().SKETCH_LINE)
export const isCircle = (o: Maybe): o is SketchCircle => isKindOf(o, L().SKETCH_CIRCLE)
export const isArc = (o: Maybe): o is SketchArc => isKindOf(o, L().SKETCH_ARC)

export const isSketchConstraint = (o: Maybe): o is SketchConstraint => isKindOf(o, L().SKETCH_CONSTRAINT)
export const isGeometricConstraint = (o: Maybe): o is GeometricConstraint => isKindOf(o, L().GEOMETRIC_CONSTRAINT)
export const isDimension = (o: Maybe): o is Dimension => isKindOf(o, L().DIMENSION)

/** The sketch an object belongs to (itself for a sketch) */
export function sketchOf(object: Maybe): Sketch | undefined {
  for (let current: Maybe = object; current; current = current.eContainer()) {
    if (isSketch(current)) return current
  }
  return undefined
}

/** The points a curve is defined by */
export function pointsOf(curve: SketchCurve): SketchPoint[] {
  if (isLine(curve)) return [curve.start, curve.end].filter(Boolean)
  if (isCircle(curve)) return [curve.center].filter(Boolean)
  if (isArc(curve)) return [curve.center, curve.start, curve.end].filter(Boolean)
  return []
}
