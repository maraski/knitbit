import { describe, expect, it } from 'vitest';
import { evaluate, isValidName, parseExpression, references, resolveDefinitions } from './expr';

const scope = { upper_chest: 114.5, bust: 124.5, ease: 10, 'ease.bust': 5, neck_width: 17 };

function val(src: string, s: Record<string, number> = scope): number {
  const r = evaluate(src, s);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('expression evaluation', () => {
  it('handles arithmetic with precedence and parentheses', () => {
    expect(val('1 + 2 * 3')).toBe(7);
    expect(val('(1 + 2) * 3')).toBe(9);
    expect(val('10 / 4')).toBe(2.5);
    expect(val('2 ^ 3 ^ 2')).toBe(512); // right-associative
    expect(val('-2 ^ 2')).toBe(-4);
    expect(val('- -3')).toBe(3);
    expect(val('.5 + 1.')).toBe(1.5);
  });

  it('references named measurements', () => {
    expect(val('upper_chest/2 + ease/4')).toBeCloseTo(59.75, 10);
    expect(val('(bust - upper_chest) * 0.5')).toBe(5);
    expect(val('upper_chest/2 + ease.bust/2')).toBe(59.75);
  });

  it('converts unit suffixes to cm', () => {
    expect(val('2in')).toBeCloseTo(5.08, 10);
    expect(val('2 in')).toBeCloseTo(5.08, 10);
    expect(val('2"')).toBeCloseTo(5.08, 10);
    expect(val('15mm + 1cm')).toBeCloseTo(2.5, 10);
    expect(val('neck_width + 1in')).toBeCloseTo(19.54, 10);
  });

  it('supports functions', () => {
    expect(val('max(neck_width, 20)')).toBe(20);
    expect(val('min(1, 2, -3)')).toBe(-3);
    expect(val('round(12.34, 0.5)')).toBe(12.5);
    expect(val('ceil(12.1)')).toBe(13);
    expect(val('floor(-1.5)')).toBe(-2);
    expect(val('clamp(30, 0, 25)')).toBe(25);
    expect(val('abs(-4)')).toBe(4);
  });

  it('reports errors with positions', () => {
    expect(evaluate('', scope)).toMatchObject({ ok: false, error: 'Expression is empty' });
    expect(evaluate('bust +', scope)).toMatchObject({ ok: false, error: 'Expression is incomplete', pos: 6 });
    expect(evaluate('hips / 2', scope)).toMatchObject({ ok: false, error: 'Unknown name "hips"', pos: 0 });
    expect(evaluate('bust / 0', scope)).toMatchObject({ ok: false, error: 'Division by zero' });
    expect(evaluate('foo(1)', scope)).toMatchObject({ ok: false, error: 'Unknown function "foo"' });
    expect(evaluate('clamp(1)', scope)).toMatchObject({ ok: false });
    expect(evaluate('(1 + 2', scope)).toMatchObject({ ok: false, error: 'Expected ")"' });
    expect(evaluate('1 $ 2', scope)).toMatchObject({ ok: false, pos: 2 });
    expect(evaluate('in + 1', scope)).toMatchObject({ ok: false });
    expect(evaluate('2 3', scope)).toMatchObject({ ok: false, error: 'Unexpected "3"' });
  });

  it('lists references', () => {
    const p = parseExpression('max(bust, upper_chest) / 2 + ease/4 - bust');
    expect(p.ok && references(p.value)).toEqual(['bust', 'upper_chest', 'ease']);
  });

  it('validates names', () => {
    expect(isValidName('neck_width')).toBe(true);
    expect(isValidName('ease.bust')).toBe(true);
    expect(isValidName('2x')).toBe(false);
    expect(isValidName('in')).toBe(false);
    expect(isValidName('max')).toBe(false);
  });
});

describe('resolveDefinitions', () => {
  it('evaluates definitions that depend on each other in any order', () => {
    const r = resolveDefinitions(
      { shoulder_width: 'cross_chest_back + 2', shoulder_each: '(shoulder_width - neck_width) / 2', neck_width: 'cross_chest_back * 0.4' },
      { cross_chest_back: 38 },
    );
    expect(r.errors).toEqual({});
    expect(r.values.shoulder_width).toBe(40);
    expect(r.values.neck_width).toBeCloseTo(15.2, 10);
    expect(r.values.shoulder_each).toBeCloseTo(12.4, 10);
  });

  it('detects cycles and propagates failures', () => {
    const r = resolveDefinitions({ a: 'b + 1', b: 'a + 1', c: 'a * 2', d: 'x / 2', e: '5' });
    expect(r.errors.a).toMatch(/Circular/);
    expect(r.errors.b).toMatch(/Circular/);
    expect(r.errors.c).toMatch(/Depends on "a"/);
    expect(r.errors.d).toMatch(/Unknown name "x"/);
    expect(r.values).toEqual({ e: 5 });
  });

  it('detects self references', () => {
    expect(resolveDefinitions({ a: 'a + 1' }).errors.a).toMatch(/Circular reference: a → a/);
  });
});
