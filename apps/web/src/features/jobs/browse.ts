import { keepPreviousData, skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { qk } from "../../api/queries.ts";
import type { ExcludedReason, JobSummary, MatchItem } from "./types.ts";

const API = "/api/v1/browse";
const PAGE_SIZE = 20;

export const FACETS = ["company", "city", "type", "degree"] as const;
export type FacetKey = (typeof FACETS)[number];
export type BrowseSort = "latest" | "match";

export interface BrowseFilters {
  q: string;
  company: string[];
  city: string[];
  type: string[];
  degree: string[];
}

export interface BrowsePage {
  items: { job: JobSummary; score: number | null }[];
  total: number;
  nextOffset: number | null;
}

export type Facets = Record<FacetKey, { value: string; count: number }[]>;

export interface MatchPreview {
  jobId: string;
  recommended: boolean;
  match: MatchItem;
  excluded?: { reason: ExcludedReason; message: string };
  belowThreshold?: boolean;
}

export const FACET_LABELS: Record<FacetKey, string> = {
  company: "公司",
  city: "城市",
  type: "类型",
  degree: "学历",
};

const VALUE_LABELS: Partial<Record<FacetKey, Record<string, string>>> = {
  type: { internship: "实习", campus: "校招", experienced: "社招" },
  degree: { any: "不限", associate: "专科", bachelor: "本科", master: "硕士", phd: "博士" },
};

export const facetValueLabel = (key: FacetKey, value: string) => VALUE_LABELS[key]?.[value] ?? value;

export function filtersFromParams(params: URLSearchParams): BrowseFilters {
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  return {
    q: params.get("q") ?? "",
    company: list("company"),
    city: list("city"),
    type: list("type"),
    degree: list("degree"),
  };
}

export function filterQuery(f: BrowseFilters): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.q) qs.set("q", f.q);
  for (const k of FACETS) if (f[k].length) qs.set(k, f[k].join(","));
  return qs;
}

export function useBrowseJobs(filters: BrowseFilters, sort: BrowseSort) {
  const base = filterQuery(filters);
  base.set("sort", sort);
  base.set("limit", String(PAGE_SIZE));
  const qs = base.toString();
  return useInfiniteQuery({
    queryKey: [...qk.jobs, "browse", qs],
    queryFn: ({ pageParam, signal }) => api.get<BrowsePage>(`${API}/jobs?${qs}&offset=${pageParam}`, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useBrowseFacets(filters: BrowseFilters) {
  const qs = filterQuery(filters).toString();
  return useQuery({
    queryKey: [...qk.jobs, "browse-facets", qs],
    queryFn: ({ signal }) => api.get<Facets>(`${API}/facets?${qs}`, signal),
    placeholderData: keepPreviousData,
  });
}

/** 只在用户点了「看看匹配度」之后才请求，结果按岗位缓存。 */
export function useMatchPreview(jobId: string | null, requested: boolean) {
  return useQuery({
    queryKey: [...qk.jobs, "browse-match", jobId],
    queryFn:
      jobId && requested
        ? () => api.post<MatchPreview>(`${API}/jobs/${encodeURIComponent(jobId)}/match`, {})
        : skipToken,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
