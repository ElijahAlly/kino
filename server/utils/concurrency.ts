/**
 * Run an async mapper across an array with bounded parallelism.
 * Used to keep TMDB request rates sane during a sync.
 */
export async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}
