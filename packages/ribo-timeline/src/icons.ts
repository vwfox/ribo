import type { EObject } from '@emfts/core'
import { isChamfer, isComponent, isConstructionPlane, isFastening, isJoint, isExtrude, isFillet, isHole, isParameter, isRevolve, isShell, isSketch } from 'ribo-model'

/** PrimeIcons class for a model object */
export function iconOf(object: EObject): string {
  if (isSketch(object)) return 'pi pi-pencil'
  if (isExtrude(object)) return 'pi pi-box'
  if (isRevolve(object)) return 'pi pi-sync'
  if (isFillet(object)) return 'pi pi-circle'
  if (isChamfer(object)) return 'pi pi-angle-right'
  if (isShell(object)) return 'pi pi-inbox'
  if (isHole(object)) return 'pi pi-arrow-down'
  if (isConstructionPlane(object)) return 'pi pi-clone'
  if (isJoint(object)) return 'pi pi-link'
  if (isFastening(object)) return 'pi pi-cog'
  if (isComponent(object)) return 'pi pi-th-large'
  if (isParameter(object)) return 'pi pi-sliders-h'
  return 'pi pi-question'
}
