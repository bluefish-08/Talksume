export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round((sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo));
}

/** 可复现的伪随机数，bootstrap 结果不随运行变化。 */
export function rng(seed = 20261105): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一次运行贡献的分子分母；比率按「合并后再除」计算，事件多的运行权重大。 */
export interface Cluster {
  stratum: string;
  num: number;
  den: number;
}

export function pooled(clusters: readonly Cluster[]): number | null {
  const den = clusters.reduce((a, c) => a + c.den, 0);
  return den === 0 ? null : clusters.reduce((a, c) => a + c.num, 0) / den;
}

function resample(clusters: readonly Cluster[], rand: () => number): Cluster[] {
  const byStratum = new Map<string, Cluster[]>();
  for (const c of clusters) byStratum.set(c.stratum, [...(byStratum.get(c.stratum) ?? []), c]);
  return [...byStratum.values()].flatMap((group) =>
    group.map(() => group[Math.floor(rand() * group.length)] as Cluster),
  );
}

export interface Interval {
  estimate: number | null;
  low: number | null;
  high: number | null;
}

function percentile(samples: number[]): [number | null, number | null] {
  if (samples.length === 0) return [null, null];
  samples.sort((a, b) => a - b);
  return [
    samples[Math.floor(samples.length * 0.025)] ?? null,
    samples[Math.ceil(samples.length * 0.975) - 1] ?? null,
  ];
}

/** 按运行聚类、按人设分层的 bootstrap，95% 百分位区间。 */
export function bootstrapRatio(clusters: readonly Cluster[], iterations = 2000): Interval {
  const rand = rng();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const v = pooled(resample(clusters, rand));
    if (v !== null) samples.push(v);
  }
  const [low, high] = percentile(samples);
  return { estimate: pooled(clusters), low, high };
}

/** B − A 的差及其 95% 区间，两组各自独立重抽。 */
export function bootstrapDiff(a: readonly Cluster[], b: readonly Cluster[], iterations = 2000): Interval {
  const rand = rng();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const x = pooled(resample(a, rand));
    const y = pooled(resample(b, rand));
    if (x !== null && y !== null) samples.push(y - x);
  }
  const pa = pooled(a);
  const pb = pooled(b);
  const [low, high] = percentile(samples);
  return { estimate: pa === null || pb === null ? null : pb - pa, low, high };
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** 2×2 表的双侧 Fisher 精确检验：a/n1 对 b/n2。 */
export function fisher(a: number, n1: number, b: number, n2: number): number {
  const k = a + b;
  const n = n1 + n2;
  const p = (x: number) =>
    Math.exp(
      logFactorial(k) +
        logFactorial(n - k) +
        logFactorial(n1) +
        logFactorial(n2) -
        logFactorial(x) -
        logFactorial(k - x) -
        logFactorial(n1 - x) -
        logFactorial(n2 - k + x) -
        logFactorial(n),
    );
  const observed = p(a);
  let total = 0;
  for (let x = Math.max(0, k - n2); x <= Math.min(k, n1); x++) {
    const px = p(x);
    if (px <= observed * (1 + 1e-9)) total += px;
  }
  return Math.min(1, total);
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

/** 有限并发地跑一组任务，结果按输入顺序返回。 */
export async function pool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T, index: number) => Promise<R>,
) {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ValueCluster {
  stratum: string;
  values: number[];
}

function resampleValues(clusters: readonly ValueCluster[], rand: () => number): number[] {
  const byStratum = new Map<string, ValueCluster[]>();
  for (const c of clusters) byStratum.set(c.stratum, [...(byStratum.get(c.stratum) ?? []), c]);
  return [...byStratum.values()].flatMap((group) =>
    group.flatMap(() => (group[Math.floor(rand() * group.length)] as ValueCluster).values),
  );
}

/** 分位数（如首字 p50）的聚类 bootstrap：一次运行的所有轮次一起抽。 */
export function bootstrapQuantile(
  a: readonly ValueCluster[],
  q: number,
  b?: readonly ValueCluster[],
  iterations = 2000,
): Interval {
  const rand = rng();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const x = quantile(resampleValues(a, rand), q);
    if (!b) {
      if (x !== null) samples.push(x);
      continue;
    }
    const y = quantile(resampleValues(b, rand), q);
    if (x !== null && y !== null) samples.push(y - x);
  }
  const qa = quantile(
    a.flatMap((c) => c.values),
    q,
  );
  const qb = b
    ? quantile(
        b.flatMap((c) => c.values),
        q,
      )
    : null;
  const [low, high] = percentile(samples);
  return { estimate: b ? (qa === null || qb === null ? null : qb - qa) : qa, low, high };
}
