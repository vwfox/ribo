import type { EObject } from '@emfts/core'
import { isExtrude, isParameter, isRevolve, isSketch } from 'ribo-model'

/** PrimeIcons class for a model object */
export function iconOf(object: EObject): string {
  if (isSketch(object)) return 'pi pi-pencil'
  if (isExtrude(object)) return 'pi pi-box'
  if (isRevolve(object)) return 'pi pi-sync'
  if (isParameter(object)) return 'pi pi-sliders-h'
  return 'pi pi-question'
}
