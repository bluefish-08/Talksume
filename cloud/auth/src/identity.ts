import type { Db } from "@talksume/db";
import {
  HttpError,
  type Identity,
  type IdentityProvider,
  installErrorHandler,
  parse,
  parseId,
  REPLIED,
  requireRole,
} from "@talksume/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { type AuthConfig, type AuthOptions, resolveAuthConfig } from "./config.ts";
import { clearedSessionCookie, readCookie, SESSION_COOKIE, sessionCookie } from "./cookies.ts";
import { type Account, AuthService } from "./service.ts";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_PREFIX = "/api/v1/auth/";

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const newPassword = z.string().min(8, "密码至少 8 位").max(128, "密码最长 128 位");
const token = z.string().min(10).max(200);

const RegisterBody = z.object({
  email,
  password: newPassword,
  displayName: z.string().trim().max(60).optional(),
  invitationToken: token.optional(),
});
const LoginBody = z.object({ email, password: z.string().min(1).max(128) });
const EmailBody = z.object({ email });
const TokenBody = z.object({ token });
const ResetBody = z.object({ token, password: newPassword });
const ChangeBody = z.object({ oldPassword: z.string().min(1).max(128), newPassword });
const DeleteBody = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.string().min(1).max(254),
});
const InviteBody = z.object({
  email: email.optional(),
  note: z.string().trim().max(200).optional(),
  ttlHours: z.number().int().min(1).max(720).default(72),
});

const GENERIC_OK = { ok: true } as const;

export interface CloudIdentity extends IdentityProvider {
  readonly service: AuthService;
  readonly config: AuthConfig;
}

interface RequestAuth {
  sessionId: string;
  account: Account;
}

/** 云端的身份实现：邮箱密码注册登录、服务端会话、HR 邀请。路由由 register 挂到 app 上。 */
export function createCloudIdentity(db: Db, options?: AuthOptions): CloudIdentity {
  const cfg = resolveAuthConfig(options, process.env);
  let logError: (err: unknown, msg: string) => void = (err, msg) => console.error(msg, err);
  const service = new AuthService(db, cfg, (err, msg) => logError(err, msg));
  const secureFor = (req: FastifyRequest): boolean =>
    cfg.secureCookie || (!cfg.appUrl && req.protocol === "https");
  const authOf = new WeakMap<FastifyRequest, RequestAuth>();

  const originAllowed = (req: FastifyRequest): boolean => {
    const origin = req.headers.origin;
    if (origin) return cfg.allowedOrigins.has(origin) || (!cfg.appUrl && sameHost(req, origin));
    const referer = req.headers.referer;
    if (!referer) return false;
    try {
      const refererOrigin = new URL(referer).origin;
      return cfg.allowedOrigins.has(refererOrigin) || (!cfg.appUrl && sameHost(req, refererOrigin));
    } catch {
      return false;
    }
  };

  // 没配 APP_URL：只放行主机名和请求 Host 一致的 Origin（端口不比，因为 nginx 转发的 Host 不带端口）
  const sameHost = (req: FastifyRequest, origin: string): boolean => {
    const host = req.headers.host?.replace(/:\d+$/, "").toLowerCase();
    try {
      return !!host && new URL(origin).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  };

  const limit = async (key: string, max: number, windowSec: number) => {
    const { allowed, retryAfterSec } = await cfg.limiter.hit(key, max, windowSec);
    if (!allowed) throw new HttpError(429, "rate_limited", "操作太频繁，请稍后再试", retryAfterSec);
  };
  const needAuth = (req: FastifyRequest): RequestAuth => {
    const found = authOf.get(req);
    if (!found) throw new HttpError(401, "unauthenticated", "请先登录");
    return found;
  };

  const provider: CloudIdentity = {
    service,
    config: cfg,
    isPublic: (path) => path.startsWith(AUTH_PREFIX),

    async resolve(req, reply) {
      const path = req.url.split("?")[0] ?? "";
      if (UNSAFE.has(req.method) && !originAllowed(req)) {
        reply.code(403).send({ error: "bad_origin", message: "请求来源不被允许" });
        return REPLIED;
      }
      const sessionToken = readCookie(req.headers.cookie, SESSION_COOKIE);
      if (!sessionToken) return null;
      const found = await service.lookupSession(sessionToken);
      if (!found) {
        reply.header("set-cookie", clearedSessionCookie(secureFor(req)));
        return null;
      }
      const { account } = found.session;
      authOf.set(req, { sessionId: found.session.id, account });
      if (found.renewed)
        reply.header("set-cookie", sessionCookie(sessionToken, found.session.expiresAt, secureFor(req)));
      if (!path.startsWith(AUTH_PREFIX) && !account.emailVerified) {
        reply.code(403).send({ error: "email_not_verified", message: "请先验证邮箱" });
        return REPLIED;
      }
      const identity: Identity = {
        userId: account.id,
        role: account.role,
        email: account.email,
        displayName: account.displayName,
      };
      return identity;
    },

    register(app) {
      logError = (err, msg) => app.log.error(err, msg);
      const setSession = (
        req: FastifyRequest,
        reply: { header(k: string, v: string): unknown },
        value: string,
        expiresAt: Date,
      ) => reply.header("set-cookie", sessionCookie(value, expiresAt, secureFor(req)));

      app.register(async (scope) => {
        installErrorHandler(scope);
        scope.addHook("onSend", async (_req, reply) => {
          reply.header("cache-control", "no-store");
        });

        scope.get("/api/v1/auth/config", async () => ({ emailEnabled: cfg.emailEnabled }));

        scope.post("/api/v1/auth/register", async (req, reply) => {
          const body = parse(RegisterBody, req.body);
          await limit(`reg:ip:${req.ip}`, 10, 3600);
          await limit(`reg:email:${body.email}`, 5, 3600);
          const direct = await service.register(body);
          if (!direct) return reply.status(202).send(GENERIC_OK);
          setSession(req, reply, direct.token, direct.expiresAt);
          return reply.status(201).send({ user: direct.account });
        });

        scope.post("/api/v1/auth/verify-email", async (req) => {
          service.assertEmailEnabled();
          const body = parse(TokenBody, req.body);
          await limit(`verify:ip:${req.ip}`, 30, 3600);
          await service.verifyEmail(body.token);
          return GENERIC_OK;
        });

        scope.post("/api/v1/auth/resend-verification", async (req, reply) => {
          service.assertEmailEnabled();
          const current = authOf.get(req)?.account;
          const body =
            current && !current.emailVerified ? { email: current.email } : parse(EmailBody, req.body);
          await limit(`resend:ip:${req.ip}`, 10, 3600);
          await limit(`resend:email:${body.email}`, 3, 3600);
          await service.resendVerification(body.email);
          return reply.status(202).send(GENERIC_OK);
        });

        scope.post("/api/v1/auth/login", async (req, reply) => {
          const body = parse(LoginBody, req.body);
          await limit(`login:ip:${req.ip}`, 30, 900);
          await limit(`login:email:${body.email}`, 10, 900);
          const {
            token: value,
            expiresAt,
            account,
          } = await service.login({
            ...body,
            userAgent: req.headers["user-agent"],
          });
          setSession(req, reply, value, expiresAt);
          return { user: account };
        });

        scope.post("/api/v1/auth/logout", async (req, reply) => {
          const value = readCookie(req.headers.cookie, SESSION_COOKIE);
          if (value) await service.logout(value);
          reply.header("set-cookie", clearedSessionCookie(secureFor(req)));
          return GENERIC_OK;
        });

        scope.get("/api/v1/auth/me", async (req) => ({ user: needAuth(req).account }));

        scope.post("/api/v1/auth/forgot-password", async (req, reply) => {
          service.assertEmailEnabled();
          const body = parse(EmailBody, req.body);
          await limit(`forgot:ip:${req.ip}`, 10, 3600);
          await limit(`forgot:email:${body.email}`, 3, 3600);
          await service.forgotPassword(body.email);
          return reply.status(202).send(GENERIC_OK);
        });

        scope.post("/api/v1/auth/reset-password", async (req) => {
          service.assertEmailEnabled();
          const body = parse(ResetBody, req.body);
          await limit(`reset:ip:${req.ip}`, 30, 3600);
          await service.resetPassword(body.token, body.password);
          return GENERIC_OK;
        });

        scope.post("/api/v1/auth/change-password", async (req) => {
          const { account, sessionId } = needAuth(req);
          const body = parse(ChangeBody, req.body);
          await limit(`pw:user:${account.id}`, 10, 900);
          await service.changePassword(account.id, sessionId, body.oldPassword, body.newPassword);
          return GENERIC_OK;
        });

        scope.post("/api/v1/auth/delete-account", async (req, reply) => {
          const { account } = needAuth(req);
          const body = parse(DeleteBody, req.body);
          await limit(`pw:user:${account.id}`, 10, 900);
          await service.deleteAccount(account.id, body.password, body.confirmation);
          reply.header("set-cookie", clearedSessionCookie(secureFor(req)));
          return GENERIC_OK;
        });

        scope.get("/api/v1/auth/invitations/peek", async (req) => {
          const query = parse(TokenBody, req.query);
          await limit(`invite:ip:${req.ip}`, 30, 3600);
          return service.peekInvitation(query.token);
        });

        scope.post("/api/v1/auth/invitations/accept", async (req) => {
          const { account } = needAuth(req);
          if (!account.emailVerified) throw new HttpError(403, "email_not_verified", "请先验证邮箱");
          const body = parse(TokenBody, req.body);
          await limit(`invite:ip:${req.ip}`, 30, 3600);
          await service.acceptInvitation(account.id, body.token);
          return GENERIC_OK;
        });

        scope.register(async (admin) => {
          admin.addHook("preHandler", requireRole("admin"));

          admin.post("/api/v1/admin/hr-invitations", async (req, reply) => {
            const body = parse(InviteBody, req.body);
            const created = await service.createInvitation(
              needAuth(req).account.id,
              body,
              req.headers.origin,
            );
            return reply.status(201).send({
              id: created.invitation.id,
              link: created.link,
              expiresAt: created.invitation.expiresAt,
            });
          });

          admin.post("/api/v1/admin/users/reset-password", async (req) => {
            const body = parse(EmailBody, req.body);
            return service.adminResetPassword(needAuth(req).account.id, body.email, req.ip);
          });

          admin.get("/api/v1/admin/hr-invitations", async () => ({ items: await service.listInvitations() }));

          admin.post("/api/v1/admin/hr-invitations/:id/revoke", async (req) => {
            await service.revokeInvitation(parseId((req.params as { id: string }).id));
            return GENERIC_OK;
          });
        });
      });
    },
  };
  return provider;
}
