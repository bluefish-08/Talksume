import { randomBytes } from "node:crypto";
import { type Db, schema } from "@talksume/db";
import { USER_IMPORT_SOURCE } from "@talksume/matching";
import { HttpError, isUniqueViolation } from "@talksume/server";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  type AuthConfig,
  normalizeEmail,
  RESET_TTL_MS,
  SESSION_MAX_MS,
  SESSION_TTL_MS,
  VERIFY_TTL_MS,
} from "./config.ts";
import { alreadyRegisteredMail, resetPasswordMail, verifyEmailMail } from "./mail-templates.ts";
import type { MailMessage } from "./mailer.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import {
  authAuditLogs,
  authPendingInvitations,
  authTokens,
  authHrInvitations as hrInvitations,
  authSessions as sessions,
} from "./schema.ts";
import { hashToken, newToken } from "./tokens.ts";

const { users } = schema;

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  role: schema.UserRole;
  emailVerified: boolean;
}

export interface SessionInfo {
  id: string;
  account: Account;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export const accountOf = (row: typeof users.$inferSelect): Account => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  role: row.role,
  emailVerified: row.emailVerifiedAt !== null,
});

const INVALID_LINK = new HttpError(400, "invalid_token", "链接无效或已过期，请重新获取");
const INVALID_INVITE = new HttpError(400, "invalid_invitation", "邀请无效或已过期");
const RENEW_AFTER_MS = 10 * 60_000;

export class AuthService {
  readonly db: Db;
  readonly cfg: AuthConfig;
  readonly #log: (err: unknown, msg: string) => void;
  #dummyHash: Promise<string> | undefined;

  constructor(db: Db, cfg: AuthConfig, log: (err: unknown, msg: string) => void) {
    this.db = db;
    this.cfg = cfg;
    this.#log = log;
  }

  /** 发信失败只记日志，不让响应暴露邮箱是否存在，也不拖慢响应。 */
  #deliver(message: MailMessage): void {
    void this.cfg.mailer?.send(message).catch((err: unknown) => this.#log(err, "send mail failed"));
  }

  #link(path: string, token: string, base = this.cfg.appUrl): string {
    return `${base ?? ""}${path}?token=${encodeURIComponent(token)}`;
  }

  /** 关邮件时，依赖邮件的接口一律明确拒绝。 */
  assertEmailEnabled(): void {
    if (!this.cfg.emailEnabled) {
      throw new HttpError(400, "email_disabled", "邮件功能未开启，请联系管理员处理");
    }
  }

  async #findByEmail(email: string) {
    const [row] = await this.db.select().from(users).where(eq(users.email, email));
    return row;
  }

  async #issueToken(userId: string, kind: "verify_email" | "reset_password", ttlMs: number): Promise<string> {
    const token = newToken();
    await this.db.insert(authTokens).values({
      userId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  async #invalidateTokens(userId: string, kind: "verify_email" | "reset_password"): Promise<void> {
    await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind), isNull(authTokens.usedAt)));
  }

  async #sendVerification(userId: string, email: string): Promise<void> {
    await this.#invalidateTokens(userId, "verify_email");
    const token = await this.#issueToken(userId, "verify_email", VERIFY_TTL_MS);
    this.#deliver(verifyEmailMail(email, this.#link("/verify-email", token)));
  }

  async #checkInvitation(token: string | undefined, email: string): Promise<string | null> {
    if (!token) return null;
    const [row] = await this.db
      .select()
      .from(hrInvitations)
      .where(eq(hrInvitations.tokenHash, hashToken(token)));
    const live = row && !row.usedAt && !row.revokedAt && row.expiresAt > new Date();
    if (!live || (row.email && row.email !== email)) throw INVALID_INVITE;
    return row.id;
  }

  async register(input: {
    email: string;
    password: string;
    displayName?: string | undefined;
    invitationToken?: string | undefined;
  }): Promise<{ token: string; expiresAt: Date; account: Account } | undefined> {
    const email = normalizeEmail(input.email);
    const pendingInvitationId = await this.#checkInvitation(input.invitationToken, email);
    if (!this.cfg.emailEnabled) return this.#registerWithoutEmail(input, email, pendingInvitationId);
    const passwordHash = await hashPassword(input.password, this.cfg.scrypt);
    const displayName = input.displayName?.trim() || email.split("@")[0] || email;

    let existing = await this.#findByEmail(email);
    if (!existing) {
      try {
        const [created] = await this.db
          .insert(users)
          .values({ email, passwordHash, displayName, role: "seeker" })
          .returning();
        if (created) {
          await this.#setPendingInvitation(created.id, pendingInvitationId);
          await this.#sendVerification(created.id, email);
          return undefined;
        }
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
      existing = await this.#findByEmail(email);
    }
    if (!existing) return;
    if (existing.emailVerifiedAt) {
      this.#deliver(
        alreadyRegisteredMail(email, `${this.cfg.appUrl}/login`, `${this.cfg.appUrl}/forgot-password`),
      );
      return;
    }
    // 未验证的账号重新注册：覆盖密码并踢掉旧会话，防止别人抢先用别人的邮箱占坑
    await this.db.update(users).set({ passwordHash, displayName }).where(eq(users.id, existing.id));
    await this.#setPendingInvitation(existing.id, pendingInvitationId);
    await this.db.delete(sessions).where(eq(sessions.userId, existing.id));
    await this.#sendVerification(existing.id, email);
  }

  /** 关邮件：注册即视为已验证并直接登录；重复邮箱只能明确提示已注册（没有邮件就无法保持不可区分）。 */
  async #registerWithoutEmail(
    input: { password: string; displayName?: string | undefined },
    email: string,
    invitationId: string | null,
  ) {
    const taken = new HttpError(409, "email_taken", "该邮箱已注册，请直接登录");
    if (await this.#findByEmail(email)) throw taken;
    const passwordHash = await hashPassword(input.password, this.cfg.scrypt);
    const displayName = input.displayName?.trim() || email.split("@")[0] || email;
    let created: typeof users.$inferSelect | undefined;
    try {
      [created] = await this.db
        .insert(users)
        .values({
          email,
          passwordHash,
          displayName,
          role: this.cfg.adminEmails.has(email) ? "admin" : "seeker",
          emailVerifiedAt: new Date(),
        })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw taken;
      throw err;
    }
    if (!created) throw new Error("user insert failed");
    if (invitationId) await this.#acceptInvitation(invitationId, created, "id");
    const [fresh] = await this.db.select().from(users).where(eq(users.id, created.id));
    const session = await this.createSession(created.id);
    return { ...session, account: accountOf(fresh ?? created) };
  }

  async #setPendingInvitation(userId: string, invitationId: string | null): Promise<void> {
    await this.db.delete(authPendingInvitations).where(eq(authPendingInvitations.userId, userId));
    if (invitationId) await this.db.insert(authPendingInvitations).values({ userId, invitationId });
  }

  async #consumeToken(token: string, kind: "verify_email" | "reset_password") {
    const [row] = await this.db
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.kind, kind),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: authTokens.userId });
    if (!row) throw INVALID_LINK;
    return row.userId;
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.#consumeToken(token, "verify_email");
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw INVALID_LINK;
    const patch: Partial<typeof users.$inferInsert> = { emailVerifiedAt: user.emailVerifiedAt ?? new Date() };
    if (this.cfg.adminEmails.has(user.email)) patch.role = "admin";
    await this.db.update(users).set(patch).where(eq(users.id, userId));
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
    const [pending] = await this.db
      .select({ invitationId: authPendingInvitations.invitationId })
      .from(authPendingInvitations)
      .where(eq(authPendingInvitations.userId, userId));
    if (pending) await this.#acceptInvitation(pending.invitationId, user, "id");
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.#findByEmail(normalizeEmail(email));
    if (user && !user.emailVerifiedAt) await this.#sendVerification(user.id, user.email);
  }

  async login(input: { email: string; password: string; userAgent?: string | undefined }) {
    const user = await this.#findByEmail(normalizeEmail(input.email));
    this.#dummyHash ??= hashPassword("talksume-dummy-password", this.cfg.scrypt);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await this.#dummyHash));
    if (!user?.passwordHash || !ok) {
      throw new HttpError(401, "invalid_credentials", "邮箱或密码错误");
    }
    let row = user;
    const patch: Partial<typeof users.$inferInsert> = {};
    // 关邮件后验证没有意义，之前开邮件时留下的未验证账号在登录时放行
    if (!user.emailVerifiedAt && !this.cfg.emailEnabled) patch.emailVerifiedAt = new Date();
    if (
      (user.emailVerifiedAt || patch.emailVerifiedAt) &&
      this.cfg.adminEmails.has(user.email) &&
      user.role !== "admin"
    ) {
      patch.role = "admin";
    }
    if (Object.keys(patch).length > 0) {
      [row = user] = await this.db.update(users).set(patch).where(eq(users.id, user.id)).returning();
    }
    const { token, expiresAt } = await this.createSession(row.id, input.userAgent);
    return { token, expiresAt, account: accountOf(row) };
  }

  async createSession(userId: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const now = Date.now();
    const expiresAt = new Date(now + SESSION_TTL_MS);
    await this.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt,
    });
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date(now)));
    return { token, expiresAt };
  }

  /** 续期时返回 renewed=true，调用方负责重发 Cookie。 */
  async lookupSession(token: string): Promise<{ session: SessionInfo; renewed: boolean } | undefined> {
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
    if (!row) return undefined;
    const now = Date.now();
    let { expiresAt, lastSeenAt } = row.session;
    let renewed = false;
    if (now - lastSeenAt.getTime() > RENEW_AFTER_MS) {
      lastSeenAt = new Date(now);
      expiresAt = new Date(Math.min(now + SESSION_TTL_MS, row.session.createdAt.getTime() + SESSION_MAX_MS));
      await this.db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, row.session.id));
      renewed = true;
    }
    return {
      renewed,
      session: {
        id: row.session.id,
        account: accountOf(row.user),
        createdAt: row.session.createdAt,
        lastSeenAt,
        expiresAt,
      },
    };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.#findByEmail(normalizeEmail(email));
    if (!user?.passwordHash) return;
    await this.#invalidateTokens(user.id, "reset_password");
    const token = await this.#issueToken(user.id, "reset_password", RESET_TTL_MS);
    this.#deliver(resetPasswordMail(user.email, this.#link("/reset-password", token)));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.#consumeToken(token, "reset_password");
    const passwordHash = await hashPassword(password, this.cfg.scrypt);
    await this.db
      .update(users)
      .set({ passwordHash, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())` })
      .where(eq(users.id, userId));
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
    await this.#invalidateTokens(userId, "reset_password");
  }

  /** 管理员兜底（尤其是没有邮件时）：生成一次性临时密码，作废该用户全部会话，并记审计。 */
  async adminResetPassword(
    actorId: string | null,
    email: string,
    ip?: string,
  ): Promise<{ temporaryPassword: string }> {
    const user = await this.#findByEmail(normalizeEmail(email));
    if (!user) throw new HttpError(404, "not_found", "没有这个账号");
    const temporaryPassword = randomBytes(12).toString("base64url");
    const passwordHash = await hashPassword(temporaryPassword, this.cfg.scrypt);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    await this.db.delete(sessions).where(eq(sessions.userId, user.id));
    await this.#invalidateTokens(user.id, "reset_password");
    await this.db.insert(authAuditLogs).values({
      actorId,
      action: "reset_password",
      targetUserId: user.id,
      targetEmail: user.email,
      ip: ip ?? null,
    });
    this.#log(null, `audit: reset_password actor=${actorId ?? "cli"} target=${user.email}`);
    return { temporaryPassword };
  }

  async #verifiedPassword(userId: string, password: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      throw new HttpError(403, "wrong_password", "密码不正确");
    }
    return user;
  }

  async changePassword(
    userId: string,
    keepSessionId: string | null,
    oldPassword: string,
    newPassword: string,
  ) {
    await this.#verifiedPassword(userId, oldPassword);
    const passwordHash = await hashPassword(newPassword, this.cfg.scrypt);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    const others = keepSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId))
      : eq(sessions.userId, userId);
    await this.db.delete(sessions).where(others);
  }

  async deleteAccount(userId: string, password: string, confirmation: string): Promise<void> {
    const user = await this.#verifiedPassword(userId, password);
    if (normalizeEmail(confirmation) !== user.email) {
      throw new HttpError(400, "confirmation_mismatch", "请输入账号邮箱以确认注销");
    }
    await this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.ownerId, userId));
      const imported = await tx
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(
          and(
            eq(schema.jobs.source, USER_IMPORT_SOURCE),
            sql`${schema.jobs.sourceJobId} like ${`${userId}:%`}`,
          ),
        );
      await tx.delete(schema.llmCallLogs).where(eq(schema.llmCallLogs.userId, userId));
      await tx.delete(authAuditLogs).where(eq(authAuditLogs.targetUserId, userId));
      await tx.delete(users).where(eq(users.id, userId));
      const importedIds = imported.map((j) => j.id);
      if (importedIds.length > 0) await tx.delete(schema.jobs).where(inArray(schema.jobs.id, importedIds));
      // 已有候选人投递的职位不能删（投递表 restrict），只下架
      const ownedIds = owned.map((j) => j.id).filter((id) => !importedIds.includes(id));
      if (ownedIds.length > 0) {
        const applied = await tx
          .selectDistinct({ id: schema.applications.jobId })
          .from(schema.applications)
          .where(inArray(schema.applications.jobId, ownedIds));
        const appliedIds = new Set(applied.map((a) => a.id));
        const removable = ownedIds.filter((id) => !appliedIds.has(id));
        if (removable.length > 0) await tx.delete(schema.jobs).where(inArray(schema.jobs.id, removable));
        if (appliedIds.size > 0) {
          await tx
            .update(schema.jobs)
            .set({ status: "closed" })
            .where(inArray(schema.jobs.id, [...appliedIds]));
        }
      }
    });
  }

  async createInvitation(
    adminId: string,
    input: { email?: string | undefined; note?: string | undefined; ttlHours: number },
    baseUrl?: string,
  ) {
    const token = newToken();
    const [row] = await this.db
      .insert(hrInvitations)
      .values({
        tokenHash: hashToken(token),
        email: input.email ? normalizeEmail(input.email) : null,
        note: input.note?.trim() || null,
        createdBy: adminId,
        expiresAt: new Date(Date.now() + input.ttlHours * 3600_000),
      })
      .returning();
    if (!row) throw new Error("invitation insert failed");
    return { invitation: row, link: this.#link("/invite", token, this.cfg.appUrl ?? baseUrl) };
  }

  async listInvitations() {
    const creator = sql<string | null>`(select email from users where id = ${hrInvitations.createdBy})`;
    const user = sql<string | null>`(select email from users where id = ${hrInvitations.usedBy})`;
    const rows = await this.db
      .select({ row: hrInvitations, createdByEmail: creator, usedByEmail: user })
      .from(hrInvitations)
      .orderBy(desc(hrInvitations.createdAt))
      .limit(200);
    const now = new Date();
    return rows.map(({ row, createdByEmail, usedByEmail }) => ({
      id: row.id,
      email: row.email,
      note: row.note,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
      createdByEmail,
      usedByEmail,
      status: row.usedAt ? "used" : row.revokedAt ? "revoked" : row.expiresAt <= now ? "expired" : "pending",
    }));
  }

  async revokeInvitation(id: string): Promise<void> {
    const [row] = await this.db
      .update(hrInvitations)
      .set({ revokedAt: new Date() })
      .where(and(eq(hrInvitations.id, id), isNull(hrInvitations.usedAt), isNull(hrInvitations.revokedAt)))
      .returning({ id: hrInvitations.id });
    if (row) return;
    const [exists] = await this.db
      .select({ usedAt: hrInvitations.usedAt })
      .from(hrInvitations)
      .where(eq(hrInvitations.id, id));
    if (!exists) throw new HttpError(404, "not_found", "邀请不存在");
    if (exists.usedAt) throw new HttpError(409, "invitation_used", "邀请已被使用，无法撤销");
  }

  async peekInvitation(token: string): Promise<{ email: string | null }> {
    const [row] = await this.db
      .select()
      .from(hrInvitations)
      .where(
        and(
          eq(hrInvitations.tokenHash, hashToken(token)),
          isNull(hrInvitations.usedAt),
          isNull(hrInvitations.revokedAt),
          gt(hrInvitations.expiresAt, new Date()),
        ),
      );
    if (!row) throw INVALID_INVITE;
    return { email: row.email };
  }

  /** 单条 UPDATE 同时判断未使用、未撤销、未过期、邮箱匹配，并发下只有一个人能成功。 */
  async #acceptInvitation(key: string, user: typeof users.$inferSelect, by: "id" | "token"): Promise<void> {
    const match = by === "id" ? eq(hrInvitations.id, key) : eq(hrInvitations.tokenHash, hashToken(key));
    const [claimed] = await this.db
      .update(hrInvitations)
      .set({ usedAt: new Date(), usedBy: user.id })
      .where(
        and(
          match,
          isNull(hrInvitations.usedAt),
          isNull(hrInvitations.revokedAt),
          gt(hrInvitations.expiresAt, new Date()),
          or(isNull(hrInvitations.email), eq(hrInvitations.email, user.email)),
        ),
      )
      .returning({ id: hrInvitations.id });
    await this.db.delete(authPendingInvitations).where(eq(authPendingInvitations.userId, user.id));
    if (!claimed) {
      if (by === "token") throw INVALID_INVITE;
      return;
    }
    if (user.role === "seeker") await this.db.update(users).set({ role: "hr" }).where(eq(users.id, user.id));
  }

  async acceptInvitation(userId: string, token: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw INVALID_INVITE;
    await this.#acceptInvitation(token, user, "token");
  }
}
