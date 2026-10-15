/**
 * Assembly placement: where each component sits.
 *
 * The design itself (component 0) and grounded components stay where their
 * own position puts them. Joints then place the components they connect, one
 * after the other: a joint ties origin 1 on component A to origin 2 on
 * component B,
 *
 *     T_A · F_1 · K  =  T_B · F_2
 *
 * with K = T(shiftX, shiftY, offset) · R_z(angle) · R_y(tiltY) · R_x(tiltX) · (flip ? I : R_x(180°)).
 * The joint kind only says which of these values the user moves.
 *
 * so whichever side is already placed decides the other. By default the z
 * axes point at each other, as two faces put together do; flip turns that off.
 *
 * Alignments (rigid joints) are no such frame ties but partial constraints,
 * solved together (see constraints.ts): several of them can hold one component.
 */

import type { FeatureProblem, Matrix } from 'ribo-contracts'
import { IDENTITY, frameMatrix, invert, multiply, placement, rotation, translation } from 'ribo-geometry'
import { isJoint, type Design, type Joint, type JointOrigin } from 'ribo-model'
import { componentIndex, isRolledBack } from './plan'
import { ALIGNMENT_TOLERANCE, alignmentError, referenceOf, solveAlignments, type Alignment } from './constraints'

export interface Assembly {
  /** Placement per component index (0: the design itself) */
  placements: Matrix[]
  /** Degrees of freedom the alignments leave, per component index; only for components placed by alignments */
  freedom: (number | undefined)[]
  problems: FeatureProblem[]
}

type Evaluate = (label: string, source: string | undefined) => number

function originMatrix(origin: JointOrigin): Matrix {
  return frameMatrix([origin.originX, origin.originY, origin.originZ], [origin.zX, origin.zY, origin.zZ], [origin.xX, origin.xY, origin.xZ])
}

/** The motion of a joint between its two origins */
export function jointMotion(joint: Joint, evaluate: Evaluate): Matrix {
  const shift = translation([evaluate('Verschiebung X', joint.shiftX), evaluate('Verschiebung Y', joint.shiftY), evaluate('Versatz', joint.offset)])
  const turn = multiply(rotation('Z', evaluate('Winkel', joint.angle)), multiply(rotation('Y', evaluate('Neigung Y', joint.tiltY)), rotation('X', evaluate('Neigung X', joint.tiltX))))
  const motion = multiply(shift, turn)
  return joint.flip ? motion : multiply(motion, rotation('X', 180))
}

/** Component index of the side a joint moves: the second, unless that one is fixed and the first is not */
export function movedBy(design: Design, joint: Joint): number {
  const fixed = (index: number) => index === 0 || design.components.get(index - 1)?.grounded === true
  const first = componentIndex(design, joint.first?.component)
  const second = componentIndex(design, joint.second?.component)
  if (!joint.second) return first
  return fixed(second) && !fixed(first) ? first : second
}

export function solveAssembly(design: Design, evaluate: Evaluate): Assembly {
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
    .map((feature, index) => ({ feature, index }))
    .filter((j): j is { feature: Joint; index: number } => isJoint(j.feature) && !j.feature.suppressed && !isRolledBack(design, j.feature, j.index))

  const valid = joints.filter(({ feature, index }) => {
    if (!feature.first || !feature.second) {
      problems.push({ index, message: 'Bezug fehlt – im Ansichtsfenster anklicken' })
      return false
    }
    if (componentIndex(design, feature.first.component) === componentIndex(design, feature.second.component)) {
      problems.push({ index, message: 'Eine Beziehung braucht zwei verschiedene Bauteile' })
      return false
    }
    return true
  })
  const isAlignment = (joint: Joint) => (joint.kind ?? 'Rigid') === 'Rigid'
  const pending = valid.filter(({ feature }) => !isAlignment(feature))
  const alignments: { alignment: Alignment; index: number }[] = []
  for (const { feature, index } of valid.filter(({ feature }) => isAlignment(feature))) {
    try {
      alignments.push({
        index,
        alignment: {
          first: referenceOf(feature.first!, componentIndex(design, feature.first!.component)),
          second: referenceOf(feature.second!, componentIndex(design, feature.second!.component)),
          flush: feature.flip,
          offset: evaluate('Abstand', feature.offset),
        },
      })
    } catch (error) {
      problems.push({ index, message: (error as Error).message })
    }
  }
  let alignmentsSolved = false
  const freedom: (number | undefined)[] = own.map(() => undefined)

  /** Solves all alignments at once, for the components not placed by anything else */
  const align = () => {
    if (alignmentsSolved || !alignments.length) return false
    alignmentsSolved = true
    const free = [...new Set(alignments.flatMap(({ alignment }) => [alignment.first.component, alignment.second.component]))].filter((c) => placements[c] === undefined)
    const current = placements.map((m, i) => m ?? own[i]!)
    const { placements: solved, freedom: left } = solveAlignments(
      alignments.map(({ alignment }) => alignment),
      free,
      current,
    )
    for (const [component, n] of left) freedom[component] = n
    for (const [component, m] of solved) {
      placements[component] = m
      current[component] = m
    }
    for (const { alignment, index } of alignments) {
      const error = alignmentError(alignment, current[alignment.first.component]!, current[alignment.second.component]!)
      if (error > ALIGNMENT_TOLERANCE * 10) {
        problems.push({
          index,
          message: free.includes(alignment.first.component) || free.includes(alignment.second.component) ? 'Widerspricht anderen Beziehungen – lässt sich nicht erfüllen' : 'Beide Bauteile liegen schon fest – diese Ausrichtung wird nicht erfüllt',
        })
      }
    }
    return free.length > 0
  }

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
          problems.push({ index, message: 'Beide Bauteile liegen schon fest – diese Beziehung wird nicht angewandt' })
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

  // Joints from the fixed parts first; then the alignments, then the joints hanging off them
  solve()
  if (align()) solve()
  // Groups joined to nothing fixed: anchor them at their own position and go on
  while (pending.length) {
    const a = componentIndex(design, pending[0]!.feature.first!.component)
    placements[a] = own[a]
    solve()
  }
  return { placements: placements.map((m, i) => m ?? own[i]!), freedom, problems }
}
