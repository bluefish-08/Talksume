import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { useStartConversation } from "../api/queries.ts";
import { useToast } from "../components/Toast.tsx";
import { Button, Chip, EmptyState, Spinner } from "../components/ui.tsx";
import { ApplyDialog, type ManualApply } from "../features/jobs/ApplyDialog.tsx";
import { BrowseJobs } from "../features/jobs/BrowseJobs.tsx";
import { applyFilter, buildChips, totalOpenJobs } from "../features/jobs/format.ts";
import {
  useAppliedJobs,
  useCreateApplication,
  useFeedback,
  useJobDetail,
  useJobSearch,
  useMatches,
  useOptimizeResume,
  useRefreshMatches,
  useRefreshResult,
  useRetryReport,
} from "../features/jobs/hooks.ts";
import { ImportDialog } from "../features/jobs/ImportDialog.tsx";
import { JobDetail, JobDetailSkeleton } from "../features/jobs/JobDetail.tsx";
import { JobList, JobListSkeleton, type JobRow } from "../features/jobs/JobList.tsx";
import styles from "../features/jobs/Jobs.module.css";
import { JobsTabs } from "../features/jobs/JobsTabs.tsx";
import type { ImportResult } from "../features/jobs/types.ts";

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : "出了点问题，请稍后再试");

export function JobsPage() {
  const [params] = useSearchParams();
  return params.get("tab") === "all" ? <BrowseJobs /> : <RecommendJobs />;
}

function RecommendJobs() {
  const toast = useToast();
  const narrow = useNarrow();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("job");

  const [input, setInput] = useState(params.get("q") ?? "");
  const q = useDebounced(input.trim(), 300);
  const [filter, setFilter] = useState("all");
  const [importing, setImporting] = useState(false);
  const [manual, setManual] = useState<ManualApply | null>(null);
  const [imported, setImported] = useState<Record<string, ImportResult>>({});

  const { query: matchesQ } = useMatches();
  const retryReport = useRetryReport();
  const refresh = useRefreshMatches();
  const refreshInfo = useRefreshResult().data;
  const searchQ = useJobSearch(q);
  const applied = useAppliedJobs().data;
  const feedback = useFeedback();
  const createApp = useCreateApplication();
  const optimize = useOptimizeResume();
  const startChat = useStartConversation();

  const searching = q.length > 0;
  const noProfile = refresh.error instanceof ApiError && refresh.error.code === "profile_not_found";

  const runRefresh = useCallback(() => {
    refresh.mutate();
  }, [refresh.mutate]);

  const autoRefreshed = useRef(false);
  const matchesLoaded = matchesQ.data;
  useEffect(() => {
    if (matchesLoaded && matchesLoaded.items.length === 0 && !autoRefreshed.current) {
      autoRefreshed.current = true;
      runRefresh();
    }
  }, [matchesLoaded, runRefresh]);

  useEffect(() => {
    setParams(
      (prev) => {
        if ((prev.get("q") ?? "") === q) return prev;
        const next = new URLSearchParams(prev);
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }, [q, setParams]);

  const select = useCallback(
    (id: string | null, replace = !narrow) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("job", id);
          else next.delete("job");
          return next;
        },
        { replace },
      );
    },
    [narrow, setParams],
  );

  const matches = useMemo(
    () => (matchesQ.data?.items ?? []).filter((m) => m.feedback !== "dislike" && m.feedback !== "irrelevant"),
    [matchesQ.data],
  );
  const matchById = useMemo(() => new Map(matches.map((m) => [m.jobId, m])), [matches]);
  const chips = useMemo(() => buildChips(matches), [matches]);
  const activeFilter = chips.some((c) => c.key === filter) ? filter : "all";

  const rows: JobRow[] = useMemo(
    () =>
      searching
        ? (searchQ.data?.items ?? []).map((job) => ({ job }))
        : applyFilter(matches, activeFilter).map((match) => ({ job: match.job, match })),
    [searching, searchQ.data, matches, activeFilter],
  );

  useEffect(() => {
    const first = rows[0];
    if (!narrow && !selectedId && first) select(first.job.id, true);
  }, [narrow, selectedId, rows, select]);

  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (narrow && selectedId) pageRef.current?.scrollTo({ top: 0 });
  }, [narrow, selectedId]);

  const importedHit = selectedId ? imported[selectedId] : undefined;
  const match = selectedId ? (matchById.get(selectedId) ?? importedHit?.match ?? undefined) : undefined;
  const detailQ = useJobDetail(selectedId);
  const listJob = rows.find((r) => r.job.id === selectedId)?.job ?? match?.job ?? importedHit?.job;
  const job = detailQ.data ?? listJob;
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
      onError: (e) =>
        toast(e instanceof ApiError && e.code === "already_applied" ? "已经投递过这个岗位了" : errorText(e), {
          tone: e instanceof ApiError && e.code === "already_applied" ? "info" : "error",
        }),
    });
  }

  function dislike() {
    if (!job) return;
    const idx = rows.findIndex((r) => r.job.id === job.id);
    const next = rows[idx + 1] ?? rows[idx - 1];
    feedback.mutate(
      { jobId: job.id, signal: "dislike" },
      {
        onSuccess: () => {
          toast("已记录，之后会少推类似的岗位");
          select(narrow ? null : (next?.job.id ?? null), true);
        },
        onError: (e) => toast(errorText(e), { tone: "error" }),
      },
    );
  }

  function onImported(r: ImportResult) {
    setImporting(false);
    setImported((all) => ({ ...all, [r.job.id]: r }));
    setInput("");
    setFilter("all");
    select(r.job.id, false);
    toast(r.match ? `已测出匹配度：${Math.round(r.match.score)}` : "已导入岗位", { tone: "success" });
  }

  const loadingList = searching ? searchQ.isPending : matchesQ.isPending || refresh.isPending;
  const showDetail = Boolean(selectedId);

  let subtitle = "根据你的简历和求职意向为你推荐";
  if (searching) {
    subtitle = searchQ.data ? `找到 ${searchQ.data.total} 个岗位，搜索结果不显示匹配度` : "搜索中…";
  } else if (matchesQ.data && matches.length > 0) {
    subtitle = `根据你的简历和求职意向，${refreshInfo ? `从 ${totalOpenJobs(refreshInfo)} 个在招岗位中筛出` : "为你筛出"} ${matches.length} 个`;
  }

  function listBody() {
    if (searching) {
      if (searchQ.isError) return <ErrorBlock error={searchQ.error} onRetry={() => void searchQ.refetch()} />;
      if (loadingList) return <JobListSkeleton />;
      if (rows.length === 0)
        return <EmptyState title={`没有找到「${q}」相关的岗位`}>换个关键词，或者按公司名试试。</EmptyState>;
      return (
        <>
          <JobList rows={rows} selectedId={selectedId} onSelect={(id) => select(id)} label="搜索结果" />
          {searchQ.data && searchQ.data.total > rows.length && (
            <p className={styles.more}>只显示前 {rows.length} 个，换个更具体的关键词可以缩小范围</p>
          )}
        </>
      );
    }
    if (noProfile) {
      return (
        <EmptyState title="先聊几句，建立你的简历">
          有了简历和求职意向，才能为你匹配岗位。
          <div className={styles.emptyActions}>
            <Button variant="primary" disabled={startChat.isPending} onClick={() => startChat.mutate()}>
              开始聊聊
            </Button>
          </div>
        </EmptyState>
      );
    }
    if (matchesQ.isError)
      return <ErrorBlock error={matchesQ.error} onRetry={() => void matchesQ.refetch()} />;
    if (refresh.isError && matches.length === 0)
      return <ErrorBlock error={refresh.error} onRetry={runRefresh} />;
    if (loadingList) {
      return (
        <>
          {refresh.isPending && (
            <p className={styles.status} role="status">
              <Spinner label="匹配中" />
              正在为你匹配岗位，大约需要几秒…
            </p>
          )}
          <JobListSkeleton />
        </>
      );
    }
    if (matches.length === 0) {
      return (
        <EmptyState title="暂时没有合适的岗位">
          {refresh.data?.hint ?? "可以补充求职意向后重新匹配，或者粘贴一份 JD 试试。"}
          <div className={styles.emptyActions}>
            <Button onClick={runRefresh}>重新匹配</Button>
          </div>
        </EmptyState>
      );
    }
    if (rows.length === 0) return <EmptyState title="没有符合筛选的岗位">换一个筛选条件试试。</EmptyState>;
    return <JobList rows={rows} selectedId={selectedId} onSelect={(id) => select(id)} label="推荐岗位" />;
  }

  function detailBody() {
    if (job) {
      return (
        <JobDetail
          key={job.id}
          job={job}
          match={match}
          excluded={importedHit?.excluded}
          jdText={detailQ.data?.jdText}
          jdLoading={detailQ.isPending}
          application={application}
          retryingReport={retryReport.isPending}
          busy={{ apply: createApp.isPending, optimize: optimize.isPending, dislike: feedback.isPending }}
          onBack={() => select(null, true)}
          onApply={apply}
          onOptimize={() =>
            optimize.mutate(
              { company: job.company, title: job.title },
              { onError: (e) => toast(errorText(e), { tone: "error" }) },
            )
          }
          onDislike={dislike}
          onRetryReport={() =>
            retryReport.mutate(job.id, { onError: (e) => toast(errorText(e), { tone: "error" }) })
          }
        />
      );
    }
    if (detailQ.isError) {
      return (
        <EmptyState title="没有找到这个岗位">
          它可能已经下架。
          <div className={styles.emptyActions}>
            <Button onClick={() => select(null, true)}>返回列表</Button>
          </div>
        </EmptyState>
      );
    }
    return <JobDetailSkeleton />;
  }

  return (
    <div ref={pageRef} className={styles.page} data-detail={showDetail ? "open" : "closed"}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <JobsTabs
            current="recommend"
            counts={{
              recommend: matchesQ.data ? matches.length : undefined,
              all: refreshInfo ? totalOpenJobs(refreshInfo) : undefined,
            }}
          />
          <p className={styles.sub}>{subtitle}</p>
        </div>
        <div className={styles.tools}>
          <label htmlFor="jb-q" className="sr-only">
            搜索岗位
          </label>
          <input
            id="jb-q"
            type="search"
            className={styles.search}
            placeholder="搜索岗位、公司"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <Button onClick={() => setImporting(true)}>粘贴 JD 测匹配</Button>
        </div>
      </header>

      {!searching && !noProfile && matches.length > 0 && (
        <fieldset className={styles.chips}>
          <legend className="sr-only">筛选岗位</legend>
          {chips.map((c) => (
            <Chip
              key={c.key}
              className={styles.chip}
              active={c.key === activeFilter}
              onClick={() => setFilter(c.key)}
            >
              {c.key === "all" ? `${c.label} ${c.count}` : c.label}
            </Chip>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className={styles.rematch}
            disabled={refresh.isPending}
            onClick={runRefresh}
          >
            {refresh.isPending ? (
              <Spinner label="匹配中" />
            ) : (
              <RefreshCw size={14} strokeWidth={1.6} aria-hidden="true" />
            )}
            重新匹配
          </Button>
        </fieldset>
      )}

      <div className={styles.layout}>
        <div className={styles.listCol}>{listBody()}</div>
        {(showDetail || (!narrow && rows.length > 0)) && (
          <div className={styles.detailCol}>{detailBody()}</div>
        )}
      </div>

      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={onImported} />}
      {manual && (
        <ApplyDialog
          apply={manual}
          onClose={() => setManual(null)}
          onApplied={() => {
            setManual(null);
            toast("已记录投递，进度可以在「投递进度」里看", { tone: "success" });
          }}
        />
      )}
    </div>
  );
}

function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <EmptyState title="加载失败">
      {errorText(error)}
      <div className={styles.emptyActions}>
        <Button onClick={onRetry}>重试</Button>
      </div>
    </EmptyState>
  );
}
