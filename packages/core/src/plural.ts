/** "1 clip", "2 clips", "0 clips": the count with the noun that fits it. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
