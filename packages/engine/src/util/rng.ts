/** Seedable deterministic PRNG (mulberry32). Never use Math.random() inside the simulation. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  nextU32(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform integer in [0, n). Returns 0 for n <= 0. */
  int(n: number): number {
    return n <= 0 ? 0 : this.nextU32() % n;
  }
}
