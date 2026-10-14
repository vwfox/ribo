/**
 * Assembly placement: where each component sits.
 *
 * The design itself (component 0) and grounded components stay where their
 * own position puts them. Joints then place the components they connect, one
 * after the other: a joint ties origin 1 on component A to origin 2 on
 * component B,
 *
 *     T_A · F_1 · K  =  T_B · F_2      with  K = R_z(angle) · T_z(offset) · (flip ? I : R_x(180°))
 *
 * so whichever side is already placed decides the other. By default the z
 * axes point at each other, as two faces put together do; flip turns that off.
 */

import type { FeatureProblem, Matrix } from 'ribo-contracts'
import { IDENTITY, frameMatrix, invert, multiply, placement, rotation, translation } from 'ribo-geometry'
import { isJoint, type Design, type Joint, type JointOrigin } from 'ribo-model'
import { componentIndex } from './plan'

export interface Assembly {
  /** Placement per component index (0: the design itself) */
  placements: Matrix[]
  problems: FeatureProblem[]
}

type Evaluate = (label: string, source: string | undefined) => number

function originMatrix(origin: JointOrigin): Matrix {
  return frameMatrix([origin.originX, origin.originY, origin.originZ], [origin.zX, origin.zY, origin.zZ], [origin.xX, origin.xY, origin.xZ])
}

/** The motion of a joint between its two origins */
export function jointMotion(joint: Joint, evaluate: Evaluate): Matrix {
  const angle = evaluate('Winkel', joint.angle)
  const offset = evaluate('Versatz', joint.offset)
  const motion = multiply(rotation('Z', angle), translation([0, 0, offset]))
  return joint.flip ? motion : multiply(motion, rotation('X', 180))
}

export function solveAssembly(design: Design, evaluate: Evaluate, end: number): Assembly {
  const components = design.components.toArray()
  const problems: FeatureProblem[] = []
  const own: Matrix[] = [IDENTITY]
  for (const component of components) {
    try {
      own.push(
        placement(
          [evaluate('Position X', component.positionX), evaluate('Position Y', component.positionY), evaluate('Position Z', component.positionZ)],
          [evaluate('Drehung X', component.rotationX), evaluate('Drehung Y', component.rotationY), evaluate('Drehung Z', component.rotationZ)],
        ),
      )
    } catch (error) {
      own.push(IDENTITY)
      problems.push({ index: -1, message: `${component.name ?? 'Bauteil'}: ${(error as Error).message}` })
    }
  }

  const placements: (Matrix | undefined)[] = own.map((m, i) => (i === 0 || components[i - 1]!.grounded ? m : undefined))
  const features = design.features.toArray()
  const joints = features
    .slice(0, end)
    .map((feature, index) => ({ feature, index }))
    .filter((j): j is { feature: Joint; index: number } => isJoint(j.feature) && !j.feature.suppressed)

  const pending = joints.filter(({ feature, index }) => {
    if (!feature.first || !feature.second) {
      problems.push({ index, message: 'Beide Gelenkursprünge anklicken' })
      return false
    }
    if (componentIndex(design, feature.first.component) === componentIndex(design, feature.second.component)) {
      problems.push({ index, message: 'Ein Gelenk braucht zwei verschiedene Bauteile' })
      return false
    }
    return true
  })

  const solve = () => {
    let progress = true
    while (progress) {
      progress = false
      for (const joint of [...pending]) {
        const { feature, index } = joint
        const a = componentIndex(design, feature.first!.component)
        const b = componentIndex(design, feature.second!.component)
        const known = [placements[a] !== undefined, placements[b] !== undefined]
        if (!known[0] && !known[1]) continue
        pending.splice(pending.indexOf(joint), 1)
        progress = true
        if (known[0] && known[1]) {
          problems.push({ index, message: 'Beide Bauteile liegen schon fest – dieses Gelenk wird nicht angewandt' })
          continue
        }
        let motion: Matrix
        try {
          motion = jointMotion(feature, evaluate)
        } catch (error) {
          problems.push({ index, message: (error as Error).message })
          continue
        }
        const f1 = originMatrix(feature.first!)
        const f2 = originMatrix(feature.second!)
        if (known[0]) placements[b] = multiply(multiply(multiply(placements[a]!, f1), motion), invert(f2))
        else placements[a] = multiply(multiply(multiply(placements[b]!, f2), invert(motion)), invert(f1))
      }
    }
  }

  solve()
  // Groups joined to nothing fixed: anchor them at their own position and go on
  while (pending.length) {
    const a = componentIndex(design, pending[0]!.feature.first!.component)
    placements[a] = own[a]
    solve()
  }
  return { placements: placements.map((m, i) => m ?? own[i]!), problems }
}
