import { schema } from "@talksume/db";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const { users } = schema;
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** 只存 token 的 SHA-256；原文只在 Cookie 里出现。 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId), index("auth_sessions_expires_idx").on(t.expiresAt)],
);

/** 邮箱验证与密码重置的一次性令牌。 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"verify_email" | "reset_password">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_tokens_user_kind_idx").on(t.userId, t.kind)],
);

export const authHrInvitations = pgTable(
  "auth_hr_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    /** 填了就只有这个邮箱能接受。 */
    email: text("email"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("auth_hr_invitations_created_idx").on(t.createdAt)],
);

/** 带邀请注册、邮箱还没验证的账号：验证通过后才消耗邀请并升为 hr。 */
export const authPendingInvitations = pgTable("auth_pending_invitations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => authHrInvitations.id, { onDelete: "cascade" }),
});

/** 管理员操作的审计记录（目前只有重置密码）。 */
export const authAuditLogs = pgTable(
  "auth_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetEmail: text("target_email").notNull(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("auth_audit_logs_created_idx").on(t.createdAt)],
);
