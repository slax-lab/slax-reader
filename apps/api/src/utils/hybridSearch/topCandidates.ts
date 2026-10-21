export class CandidateCollector<T> {
  private candidates = new Map<number, T>()

  constructor(
    private readonly limit: number,
    private readonly pruneAt: number,
    private readonly key: (item: T) => number,
    private readonly compare: (a: T, b: T) => number
  ) {}

  push(item: T): void {
    const key = this.key(item)
    const previous = this.candidates.get(key)
    if (!previous || this.compare(item, previous) < 0) {
      this.candidates.set(key, item)
    }
    if (this.candidates.size > this.pruneAt) {
      this.prune()
    }
  }

  values(): T[] {
    return [...this.candidates.values()].sort(this.compare).slice(0, this.limit)
  }

  private prune(): void {
    const top = [...this.candidates.values()].sort(this.compare).slice(0, this.limit)
    this.candidates.clear()
    for (const item of top) {
      this.candidates.set(this.key(item), item)
    }
  }
}
