import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv } from './csv';
import { SAMPLE_CSV } from './testFixtures';

describe('parseCsv', () => {
  it('parses the sample sizing table', () => {
    const t = parseCsv(SAMPLE_CSV);
    expect(t.headers[0]).toBe('size');
    expect(t.headers).toContain('armhole_depth');
    expect(t.rows).toHaveLength(10);
    expect(t.rows[0][0]).toBe('3XS');
    expect(t.rows[9][0]).toBe('4X');
  });

  it('handles quotes, escaped quotes, CRLF, BOM and blank lines', () => {
    const t = parseCsv('﻿size,"note, long"\r\n"S","say ""hi"""\r\n\r\nM,x\n');
    expect(t.headers).toEqual(['size', 'note, long']);
    expect(t.rows).toEqual([
      ['S', 'say "hi"'],
      ['M', 'x'],
    ]);
  });

  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('size;bust\nS;90')).toBe(';');
    expect(parseCsv('size\tbust\nS\t90').rows).toEqual([['S', '90']]);
  });
});
