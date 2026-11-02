import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../../api/client.ts";
import { useToast } from "../../components/Toast.tsx";
import { Button, EmptyState, Spinner } from "../../components/ui.tsx";
import { ApplyDialog, type ManualApply } from "./ApplyDialog.tsx";
import styles from "./Browse.module.css";
import { BrowseFilterBar } from "./BrowseFilters.tsx";
import {
  type BrowseSort,
  FACETS,
  type FacetKey,
  filtersFromParams,
  type MatchPreview,
  useBrowseFacets,
  useBrowseJobs,
  useMatchPreview,
} from "./browse.ts";
import {
  useAppliedJobs,
  useCreateApplication,
  useFeedback,
  useJobDetail,
  useMatches,
  useOptimizeResume,
} from "./hooks.ts";
import { JobDetail, JobDetailSkeleton } from "./JobDetail.tsx";
import { JobList, JobListSkeleton, type JobRow } from "./JobList.tsx";
import jobsStyles from "./Jobs.module.css";
import { JobsTabs } from "./JobsTabs.tsx";
import type { JobSummary } from "./types.ts";

const NARROW = "(max-width: 999px)";

function useNarrow() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "出了点问题，请稍后再试");

function previewNote(p: MatchPreview): string {
  if (p.excluded)
    return `没有进入你的推荐。${p.excluded.message}。下面是按你的简历现场算的匹配度，仅供参考。`;
  if (p.belowThreshold) return "这个岗位和你的技能、经历相关度不高，所以没有进入推荐。下面是现场算的匹配度。";
  return "这个岗位不在你当前的推荐列表里，下面是现场算的匹配度。";
}

function useApplyFlow(job: JobSummary | undefined) {
  const toast = useToast();
  const applied = useAppliedJobs().data;
  const createApp = useCreateApplication();
  const [manual, setManual] = useState<ManualApply | null>(null);
  const application = job ? applied?.get(job.id) : undefined;

  function apply() {
    if (!job) return;
    const target = { company: job.company, title: job.title, url: job.url };
    if (application?.status === "pending") {
      setManual({ applicationId: application.id, ...target });
      return;
    }
    createApp.mutate(job.id, {
      onSuccess: (r) => {
        if (r.nextAction === "manual_apply") {
          setManual({
            applicationId: r.application.id,
            ...target,
            ...(r.submitError && { submitError: r.submitError }),
          });
        } else {
          toast("已投递，进度会出现在「投递进度」里", { tone: "success" });
        }
      },
      onError: (e) => {
        const dup = e instanceof ApiError && e.code === "already_applied";
        toast(dup ? "已经投递过这个岗位了" : errorText(e), { tone: dup ? "info" : "error" });
      },
    });
  }

  const dialog = manual && (
    <ApplyDialog
      apply={manual}
      onClose={() => setManual(null)}
      onApplied={() => {
        setManual(null);
        toast("已记录投递，进度可以在「投递进度」里看", { tone: "success" });
      }}
    />
  );
  return { apply, application, applying: createApp.isPending, dialog };
}

export function BrowseJobs() {
  const toast = useToast();
  const narrow = useNarrow();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("job");
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const sort: BrowseSort = params.get("sort") === "match" ? "match" : "latest";

  const [input, setInput] = useState(filters.q);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());

  const update = useCallback(
    (patch: Record<string, string | null>, replace = true) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      const q = input.trim();
      if (q !== filters.q) update({ q: q || null, job: null });
    }, 300);
    return () => clearTimeout(t);
  }, [input, filters.q, update]);

  const listQ = useBrowseJobs(filters, sort);
  const facetsQ = useBrowseFacets(filters);
  const matches = useMatches().query.data;
  const matchById = useMemo(() => new Map((matches?.items ?? []).map((m) => [m.jobId, m])), [matches]);

  const rows: JobRow[] = useMemo(
    () =>
      (listQ.data?.pages ?? []).flatMap((p) =>
        p.items.map(({ job }) => ({ job, match: matchById.get(job.id) })),
      ),
    [listQ.data, matchById],
  );
  const total = listQ.data?.pages[0]?.total;

  const select = useCallback(
    (id: string | null, replace = !narrow) => update({ job: id }, replace),
    [narrow, update],
  );

  useEffect(() => {
    const first = rows[0];
    if (!narrow && !selectedId && first) select(first.job.id, true);
  }, [narrow, selectedId, rows, select]);

  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (narrow && selectedId) pageRef.current?.scrollTo({ top: 0 });
  }, [narrow, selectedId]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = listQ;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const recommended = selectedId ? matchById.get(selectedId) : undefined;
  const previewQ = useMatchPreview(
    selectedId,
    Boolean(selectedId && !recommended && requested.has(selectedId)),
  );
  const preview = recommended ? undefined : previewQ.data;
  const match = recommended ?? preview?.match;

  const detailQ = useJobDetail(selectedId);
  const job = detailQ.data ?? rows.find((r) => r.job.id === selectedId)?.job;
  const flow = useApplyFlow(job);
  const optimize = useOptimizeResume();
  const feedback = useFeedback();

  function setFacet(key: FacetKey, values: string[]) {
    update({ [key]: values.join(",") || null, job: null });
  }

  function clearFilters() {
    update({ ...Object.fromEntries(FACETS.map((k) => [k, null])), job: null });
  }

  function matchNote() {
    if (recommended || preview?.recommended) return undefined;
    if (preview) return <p className={styles.matchNote}>{previewNote(preview)}</p>;
    if (!selectedId) return undefined;
    return (
      <div className={styles.matchNote}>
        <p>这个岗位不在你的推荐列表里。</p>
        {previewQ.isError && <p className={styles.matchError}>{errorText(previewQ.error)}</p>}
        <Button
          variant="secondary"
          size="sm"
          disabled={previewQ.isFetching}
          onClick={() => {
            if (previewQ.isError) void previewQ.refetch();
            else setRequested((s) => new Set(s).add(selectedId));
          }}
        >
          {previewQ.isFetching && <Spinner label="计算中" />}看看我和这个岗位的匹配度
        </Button>
      </div>
    );
  }

  function listBody() {
    if (listQ.isError) {
      return (
        <EmptyState title="加载失败">
          {errorText(listQ.error)}
          <div className={jobsStyles.emptyActions}>
            <Button onClick={() => void listQ.refetch()}>重试</Button>
          </div>
        </EmptyState>
      );
    }
    if (listQ.isPending) return <JobListSkeleton />;
    if (rows.length === 0) {
      return (
        <EmptyState title="没有符合条件的岗位">
          换个关键词或放宽筛选试试。
          <div className={jobsStyles.emptyActions}>
            <Button
              onClick={() => {
                setInput("");
                update({ ...Object.fromEntries(FACETS.map((k) => [k, null])), q: null, job: null });
              }}
            >
              清除搜索和筛选
            </Button>
          </div>
        </EmptyState>
      );
    }
    return (
      <>
        <JobList rows={rows} selectedId={selectedId} onSelect={(id) => select(id)} label="全部岗位" />
        <div ref={sentinel} className={styles.loadMore}>
          {hasNextPage ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage && <Spinner label="加载中" />}加载更多
            </Button>
          ) : (
            <span>已经到底了</span>
          )}
        </div>
      </>
    );
  }

  function detailBody() {
    if (job) {
      return (
        <JobDetail
          key={job.id}
          job={job}
          match={match}
          matchNote={matchNote()}
          dimsTitle={recommended || preview?.recommended ? undefined : "匹配维度"}
          jdText={detailQ.data?.jdText}
          jdLoading={detailQ.isPending}
          application={flow.application}
          retryingReport={false}
          busy={{ apply: flow.applying, optimize: optimize.isPending, dislike: feedback.isPending }}
          onBack={() => select(null, true)}
          onApply={flow.apply}
          onOptimize={() =>
            optimize.mutate(
              { company: job.company, title: job.title },
              { onError: (e) => toast(errorText(e), { tone: "error" }) },
            )
          }
          onDislike={() =>
            feedback.mutate(
              { jobId: job.id, signal: "dislike" },
              {
                onSuccess: () => toast("已记录，之后会少推类似的岗位"),
                onError: (e) => toast(errorText(e), { tone: "error" }),
              },
            )
          }
          onRetryReport={() => {}}
        />
      );
    }
    if (detailQ.isError) {
      return (
        <EmptyState title="没有找到这个岗位">
          它可能已经下架。
          <div className={jobsStyles.emptyActions}>
            <Button onClick={() => select(null, true)}>返回列表</Button>
          </div>
        </EmptyState>
      );
    }
    return <JobDetailSkeleton />;
  }

  const showDetail = Boolean(selectedId);
  const subtitle = total === undefined ? "加载中…" : `共 ${total.toLocaleString()} 个岗位`;

  return (
    <div ref={pageRef} className={jobsStyles.page} data-detail={showDetail ? "open" : "closed"}>
      <header className={jobsStyles.header}>
        <div className={jobsStyles.heading}>
          <JobsTabs current="all" />
          <p className={jobsStyles.sub} aria-live="polite">
            {subtitle}
          </p>
        </div>
        <div className={jobsStyles.tools}>
          <label htmlFor="jb-all-q" className="sr-only">
            搜索全部岗位
          </label>
          <input
            id="jb-all-q"
            type="search"
            className={jobsStyles.search}
            placeholder="搜索岗位、公司、JD"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
      </header>

      <BrowseFilterBar
        filters={filters}
        facets={facetsQ.data}
        sort={sort}
        onFilter={setFacet}
        onSort={(s) => update({ sort: s === "latest" ? null : s, job: null })}
        onClear={clearFilters}
      />

      <div className={jobsStyles.layout}>
        <div className={jobsStyles.listCol}>{listBody()}</div>
        {(showDetail || (!narrow && rows.length > 0)) && (
          <div className={jobsStyles.detailCol}>{detailBody()}</div>
        )}
      </div>

      {flow.dialog}
    </div>
  );
}
