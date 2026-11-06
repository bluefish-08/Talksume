import { type Mailer, mailerFromEnv } from "./mailer.ts";
import { DEFAULT_SCRYPT, type ScryptParams } from "./password.ts";
import { MemoryRateLimiter, type RateLimiter } from "./rate-limit.ts";

export interface AuthOptions {
  /** 邮件功能总开关，默认关：不发邮件、注册即视为已验证并直接登录。环境变量 AUTH_EMAIL_ENABLED。 */
  emailEnabled?: boolean;
  production?: boolean;
  appUrl?: string;
  /** 额外允许的 Origin，逗号分隔写在 ALLOWED_ORIGINS 里。 */
  allowedOrigins?: string[];
  secureCookie?: boolean;
  adminEmails?: string[];
  mailer?: Mailer;
  limiter?: RateLimiter;
  scrypt?: ScryptParams;
  log?: (line: string) => void;
}

export interface AuthConfig {
  emailEnabled: boolean;
  production: boolean;
  /** 开邮件时必有；关邮件时可以没有，没有时 Origin 退回同主机校验。 */
  appUrl: string | undefined;
  allowedOrigins: Set<string>;
  secureCookie: boolean;
  adminEmails: Set<string>;
  /** 只有开邮件时才有。 */
  mailer: Mailer | undefined;
  limiter: RateLimiter;
  scrypt: ScryptParams;
}

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const SESSION_MAX_MS = 90 * 24 * 3600_000;
export const VERIFY_TTL_MS = 24 * 3600_000;
export const RESET_TTL_MS = 3600_000;

const DEV_APP_URL = "http://localhost:5173";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function resolveAuthConfig(
  options: AuthOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const production = options.production ?? env.NODE_ENV === "production";
  const emailEnabled = options.emailEnabled ?? /^(1|true)$/i.test(env.AUTH_EMAIL_ENABLED?.trim() ?? "");
  const appUrlRaw = options.appUrl ?? env.APP_URL?.trim();
  if (emailEnabled && !appUrlRaw && production)
    throw new Error("开启邮件功能时生产模式必须设置 APP_URL，例如 https://talksume.example.com");
  const appUrl = (appUrlRaw ?? (emailEnabled && !production ? DEV_APP_URL : undefined))?.replace(/\/+$/, "");
  const origins = new Set<string>(appUrl ? [new URL(appUrl).origin] : []);
  for (const extra of options.allowedOrigins ?? splitList(env.ALLOWED_ORIGINS))
    origins.add(new URL(extra).origin);
  if (!production) {
    for (const dev of ["http://localhost:5173", "http://localhost:8000"]) origins.add(dev);
  }
  const log = options.log ?? ((line: string) => console.log(line));
  const envSecure = env.COOKIE_SECURE;
  return {
    emailEnabled,
    production,
    appUrl,
    allowedOrigins: origins,
    secureCookie:
      options.secureCookie ?? (envSecure ? envSecure === "1" : (appUrl?.startsWith("https://") ?? false)),
    adminEmails: new Set((options.adminEmails ?? splitList(env.ADMIN_EMAILS)).map(normalizeEmail)),
    mailer: emailEnabled ? (options.mailer ?? mailerFromEnv(env, log, production)) : undefined,
    limiter: options.limiter ?? new MemoryRateLimiter(),
    scrypt: options.scrypt ?? DEFAULT_SCRYPT,
  };
}
