import { parseArgs } from "node:util";
import { createDb } from "@talksume/db";
import { formatReport, MigrationError, migrateOwner } from "./migrate-owner-lib.ts";

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "demo@talksume.local" },
    to: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("请设置 DATABASE_URL");
  process.exit(2);
}
if (!values.to) {
  console.error("用法：migrate-owner --from <源邮箱> --to <目标邮箱> [--dry-run]");
  process.exit(2);
}

const handle = await createDb({ url });
try {
  const report = await migrateOwner(handle.db, {
    fromEmail: values.from,
    toEmail: values.to,
    dryRun: values["dry-run"],
  });
  console.log(formatReport(report));
} catch (err) {
  console.error(err instanceof MigrationError ? err.message : err);
  process.exitCode = 1;
} finally {
  await handle.close();
}
