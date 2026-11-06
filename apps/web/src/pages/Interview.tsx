import { ArrowLeft } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router";
import { useToast } from "../components/Toast.tsx";
import { Button, EmptyState, Spinner } from "../components/ui.tsx";
import { Mock } from "../features/interview/Mock.tsx";
import { PrepList } from "../features/interview/PrepList.tsx";
import { useGeneratePrep, usePrep, useStartSession } from "../features/interview/queries.ts";
import { errorText } from "../features/tailor/changes.tsx";
import styles from "./Interview.module.css";

export function InterviewPage() {
  const { jobId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const query = usePrep(jobId);
  const generate = useGeneratePrep(jobId);
  const start = useStartSession(jobId);
  const view = query.data;
  const tab = params.get("tab") === "mock" ? "mock" : "list";
  const sessionId = params.get("s");

  const setTab = (next: "list" | "mock", session?: string | null) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("tab", next);
        if (session === null) p.delete("s");
        else if (session) p.set("s", session);
        return p;
      },
      { replace: true },
    );
  const begin = () =>
    start.mutate(undefined, {
      onSuccess: (s) => setTab("mock", s.id),
      onError: (e) => toast(errorText(e), { tone: "error" }),
    });
  const make = () => generate.mutate(undefined, { onError: (e) => toast(errorText(e), { tone: "error" }) });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.back} to={`/jobs?job=${encodeURIComponent(jobId)}`}>
          <ArrowLeft size={16} strokeWidth={1.7} aria-hidden="true" />
          回到岗位
        </Link>
        <h1 className={styles.h1}>面试准备{view && `：${view.job.company} · ${view.job.title}`}</h1>
        <p className={styles.sub}>
          题目主要从你递出去的那份简历里出，答题要点只引用你说过的话，JD 决定技术基础题和考察重点。
        </p>
      </header>

      {query.isPending && (
        <div className={styles.center}>
          <Spinner />
        </div>
      )}
      {query.isError && (
        <EmptyState title="找不到这个岗位">
          <Link to="/jobs">去看看职位推荐</Link>
        </EmptyState>
      )}
      {view && !view.prep && (
        <EmptyState title="还没有这个岗位的面试题单">
          <p className={styles.hint}>
            会根据简历、岗位描述和你说过的话出题，约需半分钟。
            {!view.available && "（当前没有配置模型，暂时不能生成）"}
          </p>
          <div className={styles.emptyActions}>
            <Button variant="primary" disabled={generate.isPending || !view.available} onClick={make}>
              {generate.isPending && <Spinner label="生成中" />}生成面试题单
            </Button>
          </div>
        </EmptyState>
      )}
      {view?.prep && (
        <>
          <div className={styles.tabs} role="tablist" aria-label="面试准备">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "list"}
              className={styles.tab}
              onClick={() => setTab("list")}
            >
              题单
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "mock"}
              className={styles.tab}
              onClick={() => setTab("mock")}
            >
              模拟面试
            </button>
          </div>
          {tab === "list" ? (
            <PrepList view={view} prep={view.prep} onMock={begin} starting={start.isPending} />
          ) : (
            <Mock
              view={view}
              sessionId={sessionId}
              onSession={(id) => setTab("mock", id)}
              onStart={begin}
              starting={start.isPending}
            />
          )}
        </>
      )}
    </div>
  );
}
