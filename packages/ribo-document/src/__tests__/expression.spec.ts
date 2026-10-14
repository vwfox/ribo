import { describe, expect, it } from 'vitest'
import { evaluateExpression, ExpressionError } from '../expression'

describe('evaluateExpression', () => {
  it('evaluates arithmetic with precedence and parentheses', () => {
    expect(evaluateExpression('2 + 3 * 4')).toBe(14)
    expect(evaluateExpression('(2 + 3) * 4')).toBe(20)
    expect(evaluateExpression('-2 ^ 2')).toBe(-4)
    expect(evaluateExpression('10 / 4')).toBe(2.5)
  })

  it('converts units to millimetres', () => {
    expect(evaluateExpression('2 cm')).toBe(20)
    expect(evaluateExpression('1 in')).toBeCloseTo(25.4)
    expect(evaluateExpression('1.5 mm + 1 cm')).toBe(11.5)
    expect(evaluateExpression('90°')).toBe(90)
  })

  it('resolves parameters and functions', () => {
    const scope = (name: string) => ({ wall: 2, width: 40 })[name]
    expect(evaluateExpression('wall * 2 + 0.4', scope)).toBeCloseTo(4.4)
    expect(evaluateExpression('max(width / 2, 30)', scope)).toBe(30)
    expect(evaluateExpression('cos(60)')).toBeCloseTo(0.5)
    expect(evaluateExpression('pi')).toBeCloseTo(Math.PI)
  })

  it('reports errors in German', () => {
    expect(() => evaluateExpression('')).toThrow(ExpressionError)
    expect(() => evaluateExpression('unknown + 1')).toThrow("Unbekannter Parameter 'unknown'")
    expect(() => evaluateExpression('1 / 0')).toThrow('Division durch 0')
    expect(() => evaluateExpression('2 +')).toThrow('unvollständig')
    expect(() => evaluateExpression('2 3')).toThrow('Unerwartetes')
  })
})
