/**
 * Mulberry32 and SplitMix32 deterministic pseudo-random number generator (PRNG)
 * Ensures 100% reproducible synthetic scenario and alert generation.
 */

export class DeterministicPRNG {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed >>> 0;
    // Warm up state with SplitMix32
    for (let i = 0; i < 4; i++) {
      this.next();
    }
  }

  /**
   * Generates a pseudo-random 32-bit unsigned integer.
   */
  public nextInt(): number {
    let z = (this.state += 0x6d2b79f5);
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return (z ^ (z >>> 14)) >>> 0;
  }

  /**
   * Generates a floating point number in [0, 1).
   */
  public next(): number {
    return this.nextInt() / 4294967296;
  }

  /**
   * Generates an integer in [min, max] inclusive.
   */
  public nextIntInRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Chooses a random element from an array.
   */
  public choose<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot choose from empty array');
    }
    const idx = Math.floor(this.next() * items.length);
    return items[idx];
  }

  /**
   * Returns a shuffled copy of an array using Fisher-Yates.
   */
  public shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const temp = copy[i];
      copy[i] = copy[j];
      copy[j] = temp;
    }
    return copy;
  }

  /**
   * Generates a boolean with given probability of true.
   */
  public nextBoolean(probability: number = 0.5): boolean {
    return this.next() < probability;
  }
}
