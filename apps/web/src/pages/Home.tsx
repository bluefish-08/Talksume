import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api/client.ts";
import { qk, useConversations, useProfile } from "../api/queries.ts";
import type { Profile } from "../api/types.ts";
import { useToast } from "../components/Toast.tsx";
import { ProgressBar } from "../components/ui.tsx";
import { Composer } from "../features/chat/Composer.tsx";
import { missingText } from "../features/resume/resumeUtils.ts";
import styles from "./Home.module.css";

const JOB_TYPE: Record<NonNullable<Profile["intention"]["jobType"]>, string> = {
  internship: "实习",
  campus: "校招",
  experienced: "社招",
};

const STARTERS = [
  { label: "聊一段实习", text: "我想聊聊我的一段实习经历：" },
  { label: "整理课程项目", text: "帮我整理一个课程项目：" },
  { label: "聊聊获奖经历", text: "我想说说我拿过的奖项：" },
  { label: "粘贴旧简历", text: "这是我之前的简历内容，帮我整理一下：\n" },
];

function intentionLabel(intention: Profile["intention"] | undefined): string | null {
  if (!intention) return null;
  const parts = [
    intention.roles.join("/"),
    intention.jobType ? JOB_TYPE[intention.jobType] : "",
    intention.cities.join("/"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function HomePage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const profile = useProfile();
  const conversations = useConversations();
  const [text, setText] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  const start = useMutation({
    mutationFn: (message: string) =>
      api.post<{ id: string; greeting: string }>("/api/v1/conversations").then((c) => ({ ...c, message })),
    onSuccess: ({ id, message }) => {
      void client.invalidateQueries({ queryKey: qk.conversations });
      navigate(`/c/${id}`, message ? { state: { initialMessage: message } } : {});
    },
    onError: (error) => toast(error.message, { tone: "error" }),
  });

  const fill = (value: string) => {
    setText(value);
    input.current?.focus();
  };

  const intention = intentionLabel(profile.data?.profile.intention);
  const completeness = profile.data?.completeness;
  const latest = conversations.data?.[0];
  const pct = Math.round((completeness?.score ?? 0) * 100);
  const missing = missingText(completeness);
  // 标题常常是用户第一句话的截断，太长就不拿来当“上次聊到”
  const topic = latest?.title && latest.title.length <= 16 ? `上次聊到「${latest.title}」` : "";
  const note = [topic, missing].filter(Boolean).join("，");

  const cardBody = (
    <>
      <span className={styles.doc} aria-hidden="true">
        <span className={styles.docTitle} />
        <span className={styles.docLine} />
        <span className={styles.docLine} />
        <span className={`${styles.docLine} ${styles.docShort}`} />
      </span>
      <span className={styles.cardMain}>
        <span className={styles.cardHead}>
          <span className={styles.cardTitle}>{latest ? "继续完善简历" : "开始完善简历"}</span>
          <span className={styles.cardPct}>{pct}%</span>
        </span>
        <ProgressBar value={completeness?.score ?? 0} label="简历完整度" />
        <span className={styles.cardNote}>{note || "和助手聊几句，简历会自动生成"}</span>
      </span>
      <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className={styles.chev} />
    </>
  );

  return (
    <div className={styles.page}>
      <div className={styles.col}>
        <div className={styles.hero}>
          <h1 className={styles.title}>
            聊几句，<span className={styles.strong}>简历就写好了</span>
          </h1>
          <p className={styles.sub}>讲讲你做过的事，我来追问细节、整理成简历、找到合适的岗位。</p>
        </div>

        <div className={styles.composer}>
          <Composer
            variant="home"
            label="说说你的经历"
            placeholder="比如：暑假在美团做后端实习，负责优惠券服务的重构……"
            rows={3}
            value={text}
            onChange={setText}
            pending={start.isPending}
            inputRef={input}
            onSubmit={() => start.mutate(text.trim())}
            tools={
              <button
                type="button"
                className={styles.pill}
                onClick={() => fill(intention ? "我想调整求职意向：" : "我的求职意向是：")}
              >
                <span className={styles.dot} aria-hidden="true" />
                {intention ?? "设置求职意向"}
              </button>
            }
          />
          <div className={styles.tray}>
            <span>试试：</span>
            {STARTERS.map((s, i) => (
              <span key={s.label} className={styles.starterWrap}>
                {i > 0 && (
                  <span className={styles.sep} aria-hidden="true">
                    ·
                  </span>
                )}
                <button type="button" className={styles.starter} onClick={() => fill(s.text)}>
                  {s.label}
                </button>
              </span>
            ))}
          </div>
        </div>

        {profile.data &&
          (latest ? (
            <Link to={`/c/${latest.id}`} className={styles.card}>
              {cardBody}
            </Link>
          ) : (
            <button
              type="button"
              className={styles.card}
              disabled={start.isPending}
              onClick={() => start.mutate("")}
            >
              {cardBody}
            </button>
          ))}
      </div>
    </div>
  );
}
