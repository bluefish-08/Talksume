import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { ApiError } from "../api/client.ts";
import { Logo } from "../components/Logo.tsx";
import { useToast } from "../components/Toast.tsx";
import { Button } from "../components/ui.tsx";
import { HrApplicationDrawer } from "../features/hr/HrApplicationDrawer.tsx";
import { HrApplicationsPane } from "../features/hr/HrApplicationsPane.tsx";
import { HrJobsPane } from "../features/hr/HrJobsPane.tsx";
import { HrSetup } from "../features/hr/HrSetup.tsx";
import {
  clearIdentity,
  type HrIdentity,
  HrProvider,
  loadIdentity,
  saveIdentity,
  useHr,
} from "../features/hr/identity.tsx";
import { JobFormDialog } from "../features/hr/JobFormDialog.tsx";
import { useHrApplications, useHrJobs } from "../features/hr/queries.ts";
import styles from "./Hr.module.css";

export function HrPage() {
  const [identity, setIdentity] = useState<HrIdentity | null>(loadIdentity);

  const signOut = useCallback(() => {
    clearIdentity();
    setIdentity(null);
  }, []);

  return (
    <div className={styles.page}>
      {identity ? (
        <HrProvider identity={identity} signOut={signOut}>
          <Workspace />
        </HrProvider>
      ) : (
        <>
          <Header />
          <HrSetup
            onDone={(next) => {
              saveIdentity(next);
              setIdentity(next);
            }}
          />
        </>
      )}
    </div>
  );
}

function Header({ who }: { who?: { name: string; company: string; signOut: () => void } }) {
  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <Logo size={17} />
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.product}>HR 工作台</span>
      </div>
      {who && (
        <div className={styles.who}>
          <span className={styles.whoText}>
            {who.name}
            {who.company && <span className={styles.company}> · {who.company}</span>}
          </span>
          <Button size="sm" variant="ghost" onClick={who.signOut}>
            切换身份
          </Button>
        </div>
      )}
    </header>
  );
}

function Workspace() {
  const { identity, signOut } = useHr();
  const toast = useToast();
  const jobs = useHrJobs();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const jobParam = params.get("job");
  const selectedJob = jobs.data?.find((j) => j.id === jobParam) ?? jobs.data?.[0];
  const selectedId = selectedJob?.id ?? null;
  const apps = useHrApplications(selectedId);
  const appId = params.get("app");

  const update = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace },
    );

  if (jobs.error instanceof ApiError && (jobs.error.status === 403 || jobs.error.status === 401)) {
    return (
      <>
        <Header />
        <div className={styles.expired}>
          <p>这个 HR 身份已经失效了。</p>
          <Button variant="dark" onClick={signOut}>
            重新创建身份
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <Header who={{ name: identity.displayName, company: identity.company, signOut }} />
      <main className={styles.main}>
        <aside className={styles.left}>
          <HrJobsPane
            jobs={jobs.data}
            loading={jobs.isPending}
            failed={jobs.isError}
            selectedId={selectedId}
            onSelect={(id) => update({ job: id, app: null })}
            onCreate={() => setCreating(true)}
          />
        </aside>
        <div className={styles.right}>
          <HrApplicationsPane
            key={selectedId ?? "none"}
            job={selectedJob}
            items={apps.data}
            loading={apps.isPending && selectedId !== null}
            failed={apps.isError}
            activeId={appId}
            onOpen={(id) => update({ app: id })}
          />
        </div>
      </main>

      {creating && (
        <JobFormDialog
          onClose={() => setCreating(false)}
          onCreated={(job) => {
            setCreating(false);
            update({ job: job.id, app: null });
            toast("岗位已发布，候选人现在可以看到并投递", { tone: "success" });
          }}
        />
      )}
      {appId && <HrApplicationDrawer key={appId} id={appId} onClose={() => update({ app: null }, true)} />}
    </>
  );
}
