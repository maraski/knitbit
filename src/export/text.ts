// Text for the PDF's built-in Helvetica, which only has the Windows Latin-1 (WinAnsi) characters. Pure; the export
// dialog uses `unprintable` for its warning before anything is loaded.

/** Characters the app uses that Helvetica lacks, and what prints instead. Arrows are drawn as shapes (see pdf.ts). */
const SWAPS: Record<string, string> = { '−': '-', '≈': '~', '≤': '<=', '≥': '>=', ' ': ' ', ' ': ' ', ' ': ' ' };

/** Arrows the PDF draws as small vector shapes in place of a character. */
export const ARROWS = ['→', '←', '↑', '↓'] as const;
export type Arrow = (typeof ARROWS)[number];

/** WinAnsi's characters outside Latin-1 (the 0x80–0x9F block of Windows-1252). */
const CP1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Helvetica (WinAnsi) can draw this character. */
export function printable(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252.has(ch);
}

/** Text with the swaps made; arrows are kept (the PDF writer draws them). */
export function helveticaText(s: string): string {
  let out = '';
  for (const ch of s) out += SWAPS[ch] ?? ch;
  return out;
}

/** Characters of `s` that still won't print after the swaps (arrows and line breaks are fine), without repeats. */
export function unprintable(s: string): string[] {
  const out: string[] = [];
  for (const ch of helveticaText(s)) {
    if (ch === '\n' || (ARROWS as readonly string[]).includes(ch) || printable(ch)) continue;
    if (!out.includes(ch)) out.push(ch);
  }
  return out;
}

/** Split text into runs of plain text and arrows. */
export function splitArrows(s: string): ({ text: string } | { arrow: Arrow })[] {
  const out: ({ text: string } | { arrow: Arrow })[] = [];
  let run = '';
  for (const ch of s) {
    if ((ARROWS as readonly string[]).includes(ch)) {
      if (run) out.push({ text: run });
      run = '';
      out.push({ arrow: ch as Arrow });
    } else run += ch;
  }
  if (run) out.push({ text: run });
  return out;
}
