import {
  APPLICATION_STATUSES,
  type ApplicationOutcome,
  type ApplicationStatus,
  type Fact,
  PROFILE_SECTIONS,
  type Profile,
  type ResumeContent,
  type StatusSource,
} from "@talksume/core";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 1024;

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const textId = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);

export type MatchDimension = { score: number; weight?: number; evidence?: string[] };
export type MatchReport = { summary?: string; strengths?: string[]; gaps?: string[] };

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  role: text("role").$type<"candidate" | "hr" | "admin">().notNull().default("candidate"),
  createdAt: createdAt(),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Profile>().notNull(),
  version: integer("version").notNull().default(1),
  completeness: jsonb("completeness").$type<Record<string, number>>().notNull().default({}),
  weights: jsonb("weights").$type<Record<string, number>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: textId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant" | "system" | "tool">().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const profileFacts = pgTable(
  "profile_facts",
  {
    id: textId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    section: text("section").$type<Fact["section"]>().notNull(),
    payload: jsonb("payload").$type<Fact["payload"]>().notNull(),
    quote: text("quote").notNull().default(""),
    sourceMessageId: text("source_message_id").references(() => messages.id, { onDelete: "set null" }),
    status: text("status").$type<Fact["status"]>().notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    index("profile_facts_user_idx").on(t.userId, t.section),
    check("profile_facts_section_check", sql`${t.section} in (${inList(PROFILE_SECTIONS)})`),
    check("profile_facts_status_check", sql`${t.status} in ('pending', 'confirmed', 'superseded')`),
  ],
);

export const resumeVersions = pgTable(
  "resume_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileVersion: integer("profile_version").notNull(),
    targetJobId: text("target_job_id").references(() => jobs.id, { onDelete: "set null" }),
    template: text("template").notNull().default("default"),
    content: jsonb("content").$type<ResumeContent>().notNull(),
    pdfKey: text("pdf_key"),
    docxKey: text("docx_key"),
    createdAt: createdAt(),
  },
  (t) => [index("resume_versions_user_idx").on(t.userId, t.createdAt)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: textId(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    jobType: text("job_type").$type<"internship" | "campus" | "experienced">(),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    degree: text("degree").$type<"any" | "associate" | "bachelor" | "master" | "phd">(),
    jdText: text("jd_text").notNull(),
    url: text("url"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
  },
  (t) => [
    unique("jobs_source_source_job_id_key").on(t.source, t.sourceJobId),
    index("jobs_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("jobs_status_idx").on(t.status),
    check("jobs_status_check", sql`${t.status} in ('open', 'closed')`),
  ],
);

export const matchResults = pgTable(
  "match_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    resumeVersionId: uuid("resume_version_id").references(() => resumeVersions.id, { onDelete: "set null" }),
    score: real("score").notNull(),
    dims: jsonb("dims").$type<Record<string, MatchDimension>>().notNull().default({}),
    report: jsonb("report").$type<MatchReport>().notNull().default({}),
    model: text("model"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("match_results_user_job_resume_key").on(t.userId, t.jobId, t.resumeVersionId).nullsNotDistinct(),
    index("match_results_user_score_idx").on(t.userId, t.score),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "restrict" }),
    resumeVersionId: uuid("resume_version_id").references(() => resumeVersions.id, { onDelete: "set null" }),
    channel: text("channel").$type<"platform_api" | "hr_workspace" | "assisted">().notNull(),
    status: text("status").$type<ApplicationStatus>().notNull().default("pending"),
    outcome: text("outcome").$type<ApplicationOutcome>(),
    externalId: text("external_id"),
    pitch: text("pitch"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("applications_user_job_key").on(t.userId, t.jobId),
    index("applications_user_status_idx").on(t.userId, t.status),
    check("applications_status_check", sql`${t.status} in (${inList(APPLICATION_STATUSES)})`),
    check("applications_outcome_check", sql`(${t.status} = 'closed') = (${t.outcome} is not null)`),
  ],
);

export const applicationEvents = pgTable(
  "application_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<ApplicationStatus>(),
    toStatus: text("to_status").$type<ApplicationStatus>().notNull(),
    outcome: text("outcome").$type<ApplicationOutcome>(),
    source: text("source").$type<StatusSource>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("application_events_application_idx").on(t.applicationId, t.createdAt)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    matchResultId: uuid("match_result_id").references(() => matchResults.id, { onDelete: "set null" }),
    signal: text("signal").$type<"like" | "dislike" | "irrelevant" | "applied">().notNull(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_user_idx").on(t.userId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"status_changed" | "follow_up" | "interview_soon">().notNull(),
    title: text("title").notNull(),
    refId: text("ref_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

export const llmCallLogs = pgTable(
  "llm_call_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    status: text("status").$type<"ok" | "error">().notNull(),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("llm_call_logs_created_idx").on(t.createdAt), index("llm_call_logs_user_idx").on(t.userId)],
);
