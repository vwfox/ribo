/**
 * Type guards over the generated model, by EClass rather than by JS class, so
 * they hold for every instance the factory creates or a resource loads.
 */

import type { EClass, EObject } from '@emfts/core'
import { RiboPackage } from './generated/ribo/RiboPackage.js'
import type {
  Design,
  Chamfer,
  Component,
  Joint,
  Fastening,
  ConstructionPlane,
  Dimension,
  EdgeFeature,
  Fillet,
  Shell,
  Extrude,
  Feature,
  GeometricConstraint,
  Hole,
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

export const isDesign = (o: Maybe): o is Design => isKindOf(o, L().DESIGN)
export const isFeature = (o: Maybe): o is Feature => isKindOf(o, L().FEATURE)
export const isSketch = (o: Maybe): o is Sketch => isKindOf(o, L().SKETCH)
export const isProfileFeature = (o: Maybe): o is ProfileFeature => isKindOf(o, L().PROFILE_FEATURE)
export const isExtrude = (o: Maybe): o is Extrude => isKindOf(o, L().EXTRUDE)
export const isRevolve = (o: Maybe): o is Revolve => isKindOf(o, L().REVOLVE)
export const isParameter = (o: Maybe): o is Parameter => isKindOf(o, L().PARAMETER)
export const isEdgeFeature = (o: Maybe): o is EdgeFeature => isKindOf(o, L().EDGE_FEATURE)
export const isFillet = (o: Maybe): o is Fillet => isKindOf(o, L().FILLET)
export const isChamfer = (o: Maybe): o is Chamfer => isKindOf(o, L().CHAMFER)
export const isShell = (o: Maybe): o is Shell => isKindOf(o, L().SHELL)
export const isHole = (o: Maybe): o is Hole => isKindOf(o, L().HOLE)
export const isComponent = (o: Maybe): o is Component => isKindOf(o, L().COMPONENT)
export const isJoint = (o: Maybe): o is Joint => isKindOf(o, L().JOINT)
export const isFastening = (o: Maybe): o is Fastening => isKindOf(o, L().FASTENING)
export const isConstructionPlane = (o: Maybe): o is ConstructionPlane => isKindOf(o, L().CONSTRUCTION_PLANE)
/** Features that modify existing bodies by picked edges or faces */
export const isBodyModifier = (o: Maybe): o is EdgeFeature | Shell => isEdgeFeature(o) || isShell(o)

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
