export function precisionAtK(rels: number[], k: number, threshold = 1): number {
  const top = rels.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter((r) => r >= threshold).length / k;
}

const gain = (rel: number) => 2 ** rel - 1;

export function ndcgAtK(rels: number[], allRels: number[], k: number): number {
  const dcg = (xs: number[]) => xs.slice(0, k).reduce((s, r, i) => s + gain(r) / Math.log2(i + 2), 0);
  const ideal = dcg([...allRels].sort((a, b) => b - a));
  return ideal > 0 ? dcg(rels) / ideal : 0;
}
