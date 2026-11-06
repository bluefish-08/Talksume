import { fileURLToPath } from "node:url";
import { type DbHandle, migrateFolder } from "@talksume/db";

export { type AuthOptions, resolveAuthConfig } from "./config.ts";
export { type CloudIdentity, createCloudIdentity } from "./identity.ts";
export { LogMailer, type Mailer, MemoryMailer, mailerFromEnv, SmtpMailer } from "./mailer.ts";
export {
  createRedisRateLimiter,
  MemoryRateLimiter,
  type RateLimiter,
  RedisRateLimiter,
} from "./rate-limit.ts";
export * as authSchema from "./schema.ts";

const AUTH_MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** 云端表有自己的迁移目录和记录表，必须在开源迁移（users 等）之后跑。 */
export function migrateCloudAuth(handle: DbHandle): Promise<void> {
  return migrateFolder(handle, { folder: AUTH_MIGRATIONS, table: "cloud_auth_migrations" });
}
