import { type Db, schema } from "@talksume/db";
import { USER_IMPORT_SOURCE } from "@talksume/matching";
import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

interface OwnedTable {
  table: PgTable;
  /** 与 user_id 组成唯一约束的其他列；目标账号已有同键行时，源行留在原账号不动。 */
  keys: string[];
}

export const OWNED_TABLES: OwnedTable[] = [
  { table: schema.profiles, keys: [] },
  { table: schema.intakeLedgers, keys: [] },
  { table: schema.conversations, keys: [] },
  { table: schema.conversationSummaries, keys: [] },
  { table: schema.profileFacts, keys: [] },
  { table: schema.resumeVersions, keys: [] },
  { table: schema.resumePolishes, keys: ["item_key", "source_hash"] },
  { table: schema.resumeTailorings, keys: ["job_id"] },
  { table: schema.matchResults, keys: ["job_id", "resume_version_id"] },
  { table: schema.applications, keys: ["job_id"] },
  { table: schema.feedback, keys: [] },
  { table: schema.notifications, keys: ["kind", "ref_id"] },
  { table: schema.llmCallLogs, keys: [] },
  { table: schema.userImages, keys: [] },
  { table: schema.resumeStyleDesigns, keys: [] },
  { table: schema.interviewPreps, keys: ["job_id"] },
  { table: schema.interviewSessions, keys: [] },
];

/** 单行主键的表：目标账号已有行时整表都不动。 */
const SINGLE_ROW = new Set(["profiles", "intake_ledgers"]);

export interface TableReport {
  table: string;
  total: number;
  moved: number;
  skipped: number;
}

export interface MigrationReport {
  from: string;
  to: string;
  dryRun: boolean;
  tables: TableReport[];
  resumeStyleCopied: boolean;
}

export class MigrationError extends Error {}

const ident = (name: string) => sql.identifier(name);

async function userByEmail(db: Pick<Db, "select">, email: string) {
  const [row] = await db
    .select({ id: schema.users.id, verified: schema.users.emailVerifiedAt })
    .from(schema.users)
    .where(eq(schema.users.email, email.trim().toLowerCase()));
  return row;
}

async function rows(tx: Db, query: ReturnType<typeof sql>): Promise<Record<string, unknown>[]> {
  const result = (await tx.execute(query)) as unknown as { rows: Record<string, unknown>[] };
  return result.rows;
}

async function rekeyImportedJobs(tx: Db, from: string, to: string): Promise<TableReport> {
  const columns = Object.values(getTableColumns(schema.jobs)).map((c) => c.name);
  const old = await rows(
    tx,
    sql`select id, source_job_id from jobs where source = ${USER_IMPORT_SOURCE} and source_job_id like ${`${from}:%`}`,
  );
  let moved = 0;
  for (const job of old) {
    const rest = String(job.source_job_id).slice(from.length + 1);
    const newSourceJobId = `${to}:${rest}`;
    const newId = `${USER_IMPORT_SOURCE}:${newSourceJobId}`;
    const [clash] = await rows(tx, sql`select 1 from jobs where id = ${newId}`);
    if (clash) continue;
    const select = columns.map((c) =>
      c === "id" ? sql`${newId}` : c === "source_job_id" ? sql`${newSourceJobId}` : ident(c),
    );
    await tx.execute(
      sql`insert into jobs (${sql.join(columns.map(ident), sql`, `)}) select ${sql.join(select, sql`, `)} from jobs where id = ${job.id}`,
    );
    for (const [table, column] of [
      ["match_results", "job_id"],
      ["applications", "job_id"],
      ["feedback", "job_id"],
      ["resume_tailorings", "job_id"],
      ["interview_preps", "job_id"],
      ["interview_sessions", "job_id"],
      ["jobs", "duplicate_of"],
    ] as const) {
      await tx.execute(
        sql`update ${ident(table)} set ${ident(column)} = ${newId} where ${ident(column)} = ${job.id}`,
      );
    }
    await tx.execute(sql`delete from jobs where id = ${job.id}`);
    moved++;
  }
  return { table: "jobs(用户导入的岗位)", total: old.length, moved, skipped: old.length - moved };
}

async function moveTable(
  tx: Db,
  { table, keys }: OwnedTable,
  from: string,
  to: string,
): Promise<TableReport> {
  const name = getTableName(table);
  const [{ n: total = 0 } = {}] = await rows(
    tx,
    sql`select count(*)::int as n from ${ident(name)} where user_id = ${from}`,
  );
  const same = SINGLE_ROW.has(name)
    ? sql`true`
    : keys.length === 0
      ? sql`false`
      : sql.join(
          keys.map((k) => sql`t2.${ident(k)} is not distinct from ${ident(name)}.${ident(k)}`),
          sql` and `,
        );
  const guard =
    SINGLE_ROW.has(name) || keys.length > 0
      ? sql`and not exists (select 1 from ${ident(name)} t2 where t2.user_id = ${to} and ${same})`
      : sql``;
  const moved = await rows(
    tx,
    sql`update ${ident(name)} set user_id = ${to} where user_id = ${from} ${guard} returning 1 as ok`,
  );
  return { table: name, total: Number(total), moved: moved.length, skipped: Number(total) - moved.length };
}

export async function migrateOwner(
  db: Db,
  input: { fromEmail: string; toEmail: string; dryRun: boolean },
): Promise<MigrationReport> {
  const from = await userByEmail(db, input.fromEmail);
  const to = await userByEmail(db, input.toEmail);
  if (!from) throw new MigrationError(`找不到源账号 ${input.fromEmail}`);
  if (!to) throw new MigrationError(`找不到目标账号 ${input.toEmail}：请先注册并验证邮箱`);
  if (from.id === to.id) throw new MigrationError("源账号和目标账号是同一个");

  const report: MigrationReport = {
    from: input.fromEmail,
    to: input.toEmail,
    dryRun: input.dryRun,
    tables: [],
    resumeStyleCopied: false,
  };
  const rollback = new Error("dry-run rollback");
  try {
    await db.transaction(async (tx) => {
      const db2 = tx as unknown as Db;
      report.tables.push(await rekeyImportedJobs(db2, from.id, to.id));
      for (const owned of OWNED_TABLES) report.tables.push(await moveTable(db2, owned, from.id, to.id));
      const copied = await rows(
        db2,
        sql`update users set resume_style = (select resume_style from users where id = ${from.id})
            where id = ${to.id} and resume_style is null
              and (select resume_style from users where id = ${from.id}) is not null returning 1 as ok`,
      );
      report.resumeStyleCopied = copied.length > 0;
      const hr = await rows(
        db2,
        sql`update jobs set owner_id = ${to.id} where owner_id = ${from.id} returning 1 as ok`,
      );
      report.tables.push({ table: "jobs(HR 发布的岗位)", total: hr.length, moved: hr.length, skipped: 0 });
      if (input.dryRun) throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  }
  return report;
}

export function formatReport(report: MigrationReport): string {
  const lines = [
    `${report.dryRun ? "[dry-run，未写入] " : ""}${report.from} → ${report.to}`,
    ...report.tables.map(
      (t) =>
        `  ${t.table.padEnd(28)} 共 ${String(t.total).padStart(5)} 行，迁移 ${String(t.moved).padStart(5)}，留在原账号 ${t.skipped}`,
    ),
    `  简历样式偏好：${report.resumeStyleCopied ? "已复制到目标账号" : "不变"}`,
  ];
  return lines.join("\n");
}
