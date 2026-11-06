import type { InterviewTurn, TurnFeedback } from "@talksume/core";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/Toast.tsx";
import { Button, EmptyState, Spinner } from "../../components/ui.tsx";
import { errorText } from "../tailor/changes.tsx";
import styles from "./Mock.module.css";
import { type PrepView, type SessionView, useSession, useSessionActions, useStartIntake } from "./queries.ts";

const STAR_LABEL = { situation: "背景", task: "任务", action: "行动", result: "结果" } as const;
const CONSISTENCY_LABEL = {
  consistent: "和简历一致",
  mismatch: "和简历对不上",
  unknown: "一致性不确定",
} as const;

function Flag({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={styles.flag} data-ok={ok || undefined}>
      {ok ? (
        <Check size={12} strokeWidth={2.2} aria-hidden="true" />
      ) : (
        <X size={12} strokeWidth={2.2} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

function Feedback({ feedback, turn }: { feedback: TurnFeedback; turn: InterviewTurn }) {
  const toast = useToast();
  const navigate = useNavigate();
  const intake = useStartIntake();
  const addToProfile = (quote: string) =>
    intake.mutate(quote, {
      onSuccess: ({ id, message }) => navigate(`/c/${id}`, { state: { initialMessage: message } }),
      onError: (e) => toast(errorText(e), { tone: "error" }),
    });

  return (
    <div className={styles.feedback}>
      <div className={styles.flags}>
        {feedback.star &&
          (Object.keys(STAR_LABEL) as (keyof typeof STAR_LABEL)[]).map((k) => (
            <Flag key={k} ok={feedback.star?.[k] ?? false}>
              {STAR_LABEL[k]}
            </Flag>
          ))}
        {feedback.metrics !== null && (
          <Flag ok={feedback.metrics}>{feedback.metrics ? "有量化结果" : "缺量化结果"}</Flag>
        )}
        <span className={styles.consistency} data-tone={feedback.consistency}>
          {CONSISTENCY_LABEL[feedback.consistency]}
        </span>
      </div>
      {feedback.mismatch.map((m) => (
        <p key={m} className={styles.mismatch}>
          <AlertTriangle size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>{m}</span>
        </p>
      ))}
      {feedback.notes.length > 0 && (
        <ul className={styles.notes}>
          {feedback.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {turn.newExperiences?.map((e) => (
        <div key={e.quote} className={styles.fresh}>
          <p>
            你提到了一段画像里还没有的经历：「{e.quote}」。模拟面试不会自动记录它，要写进画像的话需要你确认。
          </p>
          <Button size="sm" disabled={intake.isPending} onClick={() => addToProfile(e.quote)}>
            去建档对话补充
          </Button>
        </div>
      ))}
    </div>
  );
}

function Bubble({ turn }: { turn: InterviewTurn }) {
  const mine = turn.role === "candidate";
  return (
    <div className={styles.row} data-mine={mine || undefined}>
      <div className={styles.bubble} data-mine={mine || undefined}>
        {!mine && turn.source?.bullet && (
          <span className={styles.src}>对应简历：{turn.source.bullet.heading}</span>
        )}
        {!mine && turn.asked === "follow_up" && <span className={styles.src}>追问</span>}
        <p>{turn.text}</p>
      </div>
      {mine && turn.feedback && <Feedback feedback={turn.feedback} turn={turn} />}
    </div>
  );
}

function Summary({ session }: { session: SessionView }) {
  const summary = session.state.summary;
  if (!summary) return null;
  return (
    <section className={styles.summary} aria-label="面试总结">
      <h3>面试总结</h3>
      <p>{summary.overall}</p>
      {summary.strengths.length > 0 && (
        <>
          <h4>做得好的</h4>
          <ul>
            {summary.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {summary.consistency.length > 0 && (
        <>
          <h4>和简历对不上的地方</h4>
          <ul>
            {summary.consistency.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      <h4>改进清单</h4>
      <ol>
        {summary.improvements.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </section>
  );
}

function Room({ id, jobId, onRestart }: { id: string; jobId: string; onRestart: () => void }) {
  const toast = useToast();
  const query = useSession(id);
  const { answer, finish } = useSessionActions(id, jobId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const session = query.data;
  const turns = session?.state.turns.length ?? 0;
  const needsSummary = session?.state.status === "finished" && !session.state.summary;

  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在回合数变化时滚动
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [turns, pending]);

  useEffect(() => {
    if (needsSummary && !finish.isPending && !finish.isError) finish.mutate();
  }, [needsSummary, finish]);

  if (query.isPending) return <Spinner />;
  if (!session) return <EmptyState title="这场面试不存在" />;
  const active = session.state.status === "active";

  const send = () => {
    const value = text.trim();
    if (!value || answer.isPending) return;
    setPending(value);
    setText("");
    answer.mutate(value, {
      onError: (e) => {
        setText(value);
        toast(errorText(e), { tone: "error" });
      },
      onSettled: () => setPending(null),
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={styles.room}>
      <div className={styles.thread} role="log" aria-live="polite">
        {session.state.turns.map((t) => (
          <Bubble key={t.id} turn={t} />
        ))}
        {pending && (
          <>
            <div className={styles.row} data-mine>
              <div className={styles.bubble} data-mine>
                <p>{pending}</p>
              </div>
            </div>
            <p className={styles.thinking}>
              <Spinner label="面试官思考中" />
              面试官在看你的回答…
            </p>
          </>
        )}
        <Summary session={session} />
        {needsSummary && (
          <p className={styles.thinking}>
            <Spinner label="生成总结" />
            正在生成总结…
          </p>
        )}
        <div ref={end} />
      </div>
      {active ? (
        <div className={styles.composer}>
          <textarea
            aria-label="你的回答"
            value={text}
            rows={3}
            placeholder="像在真实面试里那样回答，Enter 发送，Shift+Enter 换行"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            disabled={answer.isPending}
          />
          <div className={styles.composerActions}>
            <Button
              size="sm"
              variant="ghost"
              disabled={answer.isPending || finish.isPending}
              onClick={() =>
                finish.mutate(undefined, { onError: (e) => toast(errorText(e), { tone: "error" }) })
              }
            >
              结束面试并看总结
            </Button>
            <Button variant="primary" disabled={!text.trim() || answer.isPending} onClick={send}>
              发送
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.composerActions}>
          <Button variant="primary" onClick={onRestart}>
            再来一场
          </Button>
        </div>
      )}
    </div>
  );
}

export function Mock({
  view,
  sessionId,
  onSession,
  onStart,
  starting,
}: {
  view: PrepView;
  sessionId: string | null;
  onSession: (id: string | null) => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <section className={styles.wrap} aria-label="模拟面试">
      <p className={styles.mode}>
        <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
        模拟面试模式：这里的对话和建档对话是分开的，不会修改你的画像；回答里的新经历只会提示你，由你决定要不要补充。
      </p>
      {sessionId ? (
        <Room id={sessionId} jobId={view.job.id} onRestart={onStart} />
      ) : (
        <div className={styles.intro}>
          <p>
            面试官会从你简历上的条目问起，一次问一题，你回答后给简短点评，追问一到两轮再换题；
            回答和简历对不上时会直接提醒你。
          </p>
          <Button variant="primary" size="lg" disabled={starting} onClick={onStart}>
            {starting && <Spinner label="准备中" />}开始模拟面试
          </Button>
          {view.sessions.length > 0 && (
            <div className={styles.history}>
              <h4>之前的模拟面试</h4>
              <ul>
                {view.sessions.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.link} onClick={() => onSession(s.id)}>
                      {new Date(s.updatedAt).toLocaleString("zh-CN")} · 回答了 {s.answered} 题 ·{" "}
                      {s.status === "active" ? "未结束" : "已结束"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
