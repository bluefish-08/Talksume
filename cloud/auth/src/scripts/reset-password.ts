import { parseArgs } from "node:util";
import { createDb } from "@talksume/db";
import { resolveAuthConfig } from "../config.ts";
import { AuthService } from "../service.ts";

// 兜底：没有管理员能登录时，在服务器上直接给某个邮箱重置一个临时密码
const { values } = parseArgs({ options: { email: { type: "string" } } });
const url = process.env.DATABASE_URL;
if (!url || !values.email) {
  console.error("用法：DATABASE_URL=... reset-password --email <邮箱>");
  process.exit(2);
}

const handle = await createDb({ url });
try {
  const config = resolveAuthConfig({ emailEnabled: false }, process.env);
  const service = new AuthService(handle.db, config, (err, msg) =>
    err ? console.error(msg, err) : console.log(msg),
  );
  const { temporaryPassword } = await service.adminResetPassword(null, values.email);
  console.log(`已重置 ${values.email}，该用户所有会话已作废。临时密码（只显示这一次）：${temporaryPassword}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
