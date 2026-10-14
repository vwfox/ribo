/**
 * Evaluator for dimension expressions such as `wall * 2 + 0.4 mm`.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('+' | '-') unary | power
 *   power   := postfix ('^' unary)?
 *   postfix := primary unit?
 *   primary := number | name | name '(' expr (',' expr)* ')' | '(' expr ')'
 *
 * Lengths come out in millimetres, angles in degrees. A unit only scales the
 * value; dimensional consistency is not checked.
 */

export class ExpressionError extends Error {
  override name = 'ExpressionError'
}

const UNITS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  deg: 1,
  '°': 1,
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  sin: (d) => Math.sin(toRadians(d)),
  cos: (d) => Math.cos(toRadians(d)),
  tan: (d) => Math.tan(toRadians(d)),
}

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'name'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number }
  | { type: 'end'; pos: number }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(i))
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0].replace(',', '.')), pos: i })
      i += number[0].length
      continue
    }
    const name = /^[A-Za-z_À-ɏ][\wÀ-ɏ]*/.exec(source.slice(i))
    if (name) {
      tokens.push({ type: 'name', value: name[0], pos: i })
      i += name[0].length
      continue
    }
    if ('+-*/^(),°'.includes(c)) {
      tokens.push(c === '°' ? { type: 'name', value: '°', pos: i } : { type: 'op', value: c, pos: i })
      i++
      continue
    }
    throw new ExpressionError(`Unerwartetes Zeichen '${c}'`)
  }
  tokens.push({ type: 'end', pos: source.length })
  return tokens
}

export type Scope = (name: string) => number | undefined

export function evaluateExpression(source: string, scope: Scope = () => undefined): number {
  const text = (source ?? '').trim()
  if (text === '') throw new ExpressionError('Ausdruck ist leer')

  const tokens = tokenize(text)
  let index = 0
  const peek = () => tokens[index]!
  const next = () => tokens[index++]!
  const isOp = (value: string) => {
    const t = peek()
    return t.type === 'op' && t.value === value
  }
  const expectOp = (value: string) => {
    if (!isOp(value)) throw new ExpressionError(`'${value}' erwartet`)
    next()
  }

  function expr(): number {
    let value = term()
    while (isOp('+') || isOp('-')) {
      const op = next() as { value: string }
      const right = term()
      value = op.value === '+' ? value + right : value - right
    }
    return value
  }

  function term(): number {
    let value = unary()
    while (isOp('*') || isOp('/')) {
      const op = next() as { value: string }
      const right = unary()
      if (op.value === '/' && right === 0) throw new ExpressionError('Division durch 0')
      value = op.value === '*' ? value * right : value / right
    }
    return value
  }

  function unary(): number {
    if (isOp('-')) {
      next()
      return -unary()
    }
    if (isOp('+')) {
      next()
      return unary()
    }
    return power()
  }

  function power(): number {
    const base = postfix()
    if (isOp('^')) {
      next()
      return base ** unary()
    }
    return base
  }

  function postfix(): number {
    const value = primary()
    const t = peek()
    if (t.type === 'name' && t.value in UNITS) {
      next()
      return value * UNITS[t.value]!
    }
    return value
  }

  function primary(): number {
    const t = next()
    if (t.type === 'number') return t.value
    if (t.type === 'op' && t.value === '(') {
      const value = expr()
      expectOp(')')
      return value
    }
    if (t.type === 'name') {
      if (isOp('(')) {
        const fn = FUNCTIONS[t.value]
        if (!fn) throw new ExpressionError(`Unbekannte Funktion '${t.value}'`)
        next()
        const args = [expr()]
        while (isOp(',')) {
          next()
          args.push(expr())
        }
        expectOp(')')
        return fn(...args)
      }
      const value = scope(t.value) ?? CONSTANTS[t.value]
      if (value === undefined) throw new ExpressionError(`Unbekannter Parameter '${t.value}'`)
      return value
    }
    if (t.type === 'end') throw new ExpressionError('Ausdruck ist unvollständig')
    throw new ExpressionError(`Unerwartetes '${t.value}'`)
  }

  const value = expr()
  if (peek().type !== 'end') throw new ExpressionError(`Unerwartetes '${text.slice(peek().pos)}'`)
  if (!Number.isFinite(value)) throw new ExpressionError('Ergebnis ist keine endliche Zahl')
  return value
}
