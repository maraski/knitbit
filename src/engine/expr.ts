// A small, safe arithmetic expression language for waypoint dimensions,
// e.g. `upper_chest/2 + ease/4`, `max(back_neck_width, 15)`, `2in + 1.5`.
// All lengths evaluate to centimetres; bare numbers are cm, `in`/`mm`/`cm` suffixes convert.

import { CM_PER_INCH } from './units';

export type Expr =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'ref'; name: string; pos: number }
  | { kind: 'unary'; op: '-'; arg: Expr; pos: number }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: Expr; right: Expr; pos: number }
  | { kind: 'call'; fn: string; args: Expr[]; pos: number };

export class ExprError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; pos?: number };

const UNIT_FACTORS: Record<string, number> = { cm: 1, mm: 0.1, in: CM_PER_INCH };

/** Names that cannot be used as measurements because they are unit suffixes or functions. */
export const RESERVED_NAMES = new Set(['cm', 'mm', 'in']);

interface FnDef {
  arity: [number, number];
  impl: (...a: number[]) => number;
  doc: string;
}

export const FUNCTIONS: Record<string, FnDef> = {
  min: { arity: [1, Infinity], impl: Math.min, doc: 'min(a, b, …) smallest value' },
  max: { arity: [1, Infinity], impl: Math.max, doc: 'max(a, b, …) largest value' },
  abs: { arity: [1, 1], impl: Math.abs, doc: 'abs(x) absolute value' },
  sqrt: { arity: [1, 1], impl: (x) => Math.sqrt(Math.max(0, x)), doc: 'sqrt(x) square root (of 0 for negatives)' },
  floor: { arity: [1, 2], impl: (x, s = 1) => Math.floor(x / s) * s, doc: 'floor(x[, step]) round down (to a step)' },
  ceil: { arity: [1, 2], impl: (x, s = 1) => Math.ceil(x / s) * s, doc: 'ceil(x[, step]) round up (to a step)' },
  round: { arity: [1, 2], impl: (x, s = 1) => Math.round(x / s) * s, doc: 'round(x[, step]) round to nearest (step)' },
  clamp: { arity: [3, 3], impl: (x, lo, hi) => Math.min(hi, Math.max(lo, x)), doc: 'clamp(x, lo, hi) limit to a range' },
};

// ---------- tokenizer ----------

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`Unexpected "${c}"`, i);
      toks.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      toks.push({ t: 'op', v: c, pos: i });
      i++;
    } else if (c === '"') {
      // 2" means 2 inches
      toks.push({ t: 'id', v: 'in', pos: i });
      i++;
    } else {
      throw new ExprError(`Unexpected character "${c}"`, i);
    }
  }
  toks.push({ t: 'end', pos: src.length });
  return toks;
}

// ---------- parser (recursive descent) ----------

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new ExprError(`Expected "${v}"`, t.pos);
  }

  parse(): Expr {
    const e = this.sum();
    const t = this.peek();
    if (t.t !== 'end') throw new ExprError(`Unexpected ${describe(t)}`, t.pos);
    return e;
  }

  private sum(): Expr {
    let left = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const t = this.next() as { v: '+' | '-'; pos: number };
      left = { kind: 'binary', op: t.v, left, right: this.product(), pos: t.pos };
    }
    return left;
  }

  private product(): Expr {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const t = this.next() as { v: '*' | '/'; pos: number };
      left = { kind: 'binary', op: t.v, left, right: this.unary(), pos: t.pos };
    }
    return left;
  }

  private unary(): Expr {
    if (this.isOp('-')) {
      const t = this.next();
      return { kind: 'unary', op: '-', arg: this.unary(), pos: t.pos };
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.atom();
    if (this.isOp('^')) {
      const t = this.next();
      return { kind: 'binary', op: '^', left: base, right: this.unary(), pos: t.pos };
    }
    return base;
  }

  private atom(): Expr {
    const t = this.next();
    if (t.t === 'num') {
      const u = this.peek();
      if (u.t === 'id' && u.v in UNIT_FACTORS) {
        this.next();
        return { kind: 'num', value: t.v * UNIT_FACTORS[u.v], pos: t.pos };
      }
      return { kind: 'num', value: t.v, pos: t.pos };
    }
    if (t.t === 'id') {
      if (this.isOp('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.isOp(')')) {
          args.push(this.sum());
          while (this.isOp(',')) {
            this.next();
            args.push(this.sum());
          }
        }
        this.expectOp(')');
        const fn = FUNCTIONS[t.v];
        if (!fn) throw new ExprError(`Unknown function "${t.v}"`, t.pos);
        if (args.length < fn.arity[0] || args.length > fn.arity[1]) {
          throw new ExprError(`${t.v}() takes ${arityText(fn.arity)} argument(s), got ${args.length}`, t.pos);
        }
        return { kind: 'call', fn: t.v, args, pos: t.pos };
      }
      if (t.v in UNIT_FACTORS) throw new ExprError(`"${t.v}" must follow a number`, t.pos);
      return { kind: 'ref', name: t.v, pos: t.pos };
    }
    if (t.t === 'op' && t.v === '(') {
      const e = this.sum();
      this.expectOp(')');
      return e;
    }
    throw new ExprError(t.t === 'end' ? 'Expression is incomplete' : `Unexpected ${describe(t)}`, t.pos);
  }
}

function describe(t: Tok): string {
  return t.t === 'end' ? 'end of expression' : `"${t.v}"`;
}

function arityText([lo, hi]: [number, number]): string {
  if (lo === hi) return String(lo);
  return hi === Infinity ? `at least ${lo}` : `${lo}–${hi}`;
}

// ---------- public API ----------

export function parseExpression(src: string): Result<Expr> {
  try {
    if (src.trim() === '') return { ok: false, error: 'Expression is empty', pos: 0 };
    return { ok: true, value: new Parser(tokenize(src)).parse() };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

/** Look up a name; return undefined when unknown. */
export type Scope = (name: string) => number | undefined;

export function scopeFrom(values: Record<string, number>): Scope {
  return (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined);
}

export function evaluateAst(ast: Expr, scope: Scope): number {
  switch (ast.kind) {
    case 'num':
      return ast.value;
    case 'ref': {
      const v = scope(ast.name);
      if (v === undefined) throw new ExprError(`Unknown name "${ast.name}"`, ast.pos);
      return v;
    }
    case 'unary':
      return -evaluateAst(ast.arg, scope);
    case 'binary': {
      const a = evaluateAst(ast.left, scope);
      const b = evaluateAst(ast.right, scope);
      switch (ast.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          if (b === 0) throw new ExprError('Division by zero', ast.pos);
          return a / b;
        case '^':
          return a ** b;
      }
      break;
    }
    case 'call': {
      const fn = FUNCTIONS[ast.fn];
      return fn.impl(...ast.args.map((a) => evaluateAst(a, scope)));
    }
  }
  throw new ExprError('Invalid expression', 0);
}

export function evaluate(src: string, scope: Scope | Record<string, number>): Result<number> {
  const parsed = parseExpression(src);
  if (!parsed.ok) return parsed;
  const s = typeof scope === 'function' ? scope : scopeFrom(scope);
  try {
    const v = evaluateAst(parsed.value, s);
    if (!Number.isFinite(v)) return { ok: false, error: 'Result is not a finite number', pos: 0 };
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

/** Names an expression refers to (deduplicated, in order of appearance). */
export function references(ast: Expr): string[] {
  const out: string[] = [];
  const walk = (e: Expr): void => {
    if (e.kind === 'ref') {
      if (!out.includes(e.name)) out.push(e.name);
    } else if (e.kind === 'unary') walk(e.arg);
    else if (e.kind === 'binary') {
      walk(e.left);
      walk(e.right);
    } else if (e.kind === 'call') e.args.forEach(walk);
  };
  walk(ast);
  return out;
}

export function isValidName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name) && !RESERVED_NAMES.has(name) && !(name in FUNCTIONS);
}

export interface ResolvedDefinitions {
  values: Record<string, number>;
  errors: Record<string, string>;
}

/**
 * Evaluate a set of named expressions that may refer to each other and to fixed base values,
 * e.g. { back_neck_width: 'cross_back * 0.45' } with base { cross_back: 38.25 }.
 * Detects cycles; a definition that fails makes its dependents fail too, with the cause named.
 */
export function resolveDefinitions(defs: Record<string, string>, base: Record<string, number> = {}): ResolvedDefinitions {
  const values: Record<string, number> = { ...base };
  const errors: Record<string, string> = {};
  const state: Record<string, 'visiting' | 'done'> = {};

  const visit = (name: string, chain: string[]): void => {
    if (state[name] === 'done') return;
    if (state[name] === 'visiting') {
      const cycle = [...chain.slice(chain.indexOf(name)), name].join(' → ');
      for (const n of chain.slice(chain.indexOf(name))) errors[n] = `Circular reference: ${cycle}`;
      return;
    }
    state[name] = 'visiting';
    const parsed = parseExpression(defs[name]);
    if (!parsed.ok) {
      errors[name] = parsed.error;
    } else {
      for (const ref of references(parsed.value)) {
        if (ref in defs) visit(ref, [...chain, name]);
      }
      if (!errors[name]) {
        const failed = references(parsed.value).find((r) => r in errors);
        if (failed) {
          errors[name] = `Depends on "${failed}", which has an error`;
        } else {
          try {
            values[name] = evaluateAst(parsed.value, scopeFrom(values));
          } catch (e) {
            errors[name] = e instanceof ExprError ? e.message : String(e);
          }
        }
      }
    }
    state[name] = 'done';
  };

  for (const name of Object.keys(defs)) visit(name, []);
  for (const name of Object.keys(errors)) delete values[name];
  return { values, errors };
}

/**
 * Rewrite the names an expression refers to, keeping everything else exactly as typed.
 * `map` returns the new name, or undefined to leave a name alone. Invalid expressions are
 * rewritten with a conservative whole-name match so a rename still reaches them.
 */
export function renameReferences(src: string, map: (name: string) => string | undefined): string {
  let toks: Tok[];
  try {
    toks = tokenize(src);
  } catch {
    return src.replace(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/g, (m) => map(m) ?? m);
  }
  let out = src;
  for (const t of [...toks].reverse()) {
    if (t.t !== 'id' || src.slice(t.pos, t.pos + t.v.length) !== t.v) continue; // skips the `"` inch shorthand
    const next = map(t.v);
    if (next !== undefined && next !== t.v) out = out.slice(0, t.pos) + next + out.slice(t.pos + t.v.length);
  }
  return out;
}
