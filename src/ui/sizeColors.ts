// Sequential colour ramp for sizes: light for the smallest, dark for the largest (reads as "bigger").

export function sizeColor(index: number, count: number): string {
  const t = count <= 1 ? 1 : index / (count - 1);
  const hue = 200 + t * 20; // blue, slightly deepening
  const sat = 40 + t * 25;
  const light = 74 - t * 52;
  return `hsl(${hue.toFixed(0)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}
