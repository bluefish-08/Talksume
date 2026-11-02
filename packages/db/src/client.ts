import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbOptions = { url: string } | { pglite: string };

export interface DbHandle {
  readonly db: Db;
  readonly driver: "node-postgres" | "pglite";
  close(): Promise<void>;
}

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** `pglite` 传目录路径持久化，传 `memory://` 用内存库。 */
export async function createDb(options: DbOptions): Promise<DbHandle> {
  if ("url" in options) {
    const pool = new pg.Pool({ connectionString: options.url });
    return {
      db: drizzleNodePg(pool, { schema }),
      driver: "node-postgres",
      close: () => pool.end(),
    };
  }
  const client = await PGlite.create(options.pglite, { extensions: { vector } });
  return {
    db: drizzlePglite(client, { schema }),
    driver: "pglite",
    close: () => client.close(),
  };
}

export async function migrate(handle: DbHandle): Promise<void> {
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  if (handle.driver === "pglite") {
    await migratePglite(handle.db as Parameters<typeof migratePglite>[0], config);
  } else {
    await migrateNodePg(handle.db as Parameters<typeof migrateNodePg>[0], config);
  }
}
