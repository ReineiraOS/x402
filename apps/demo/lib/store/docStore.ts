import { promises as fs } from "node:fs";
import path from "node:path";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getTenantId } from "../tenant";

const databaseUrl =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL ?? "";

export const storageBackend: "file" | "postgres" = databaseUrl ? "postgres" : "file";

if (process.env.VERCEL && storageBackend === "file") {
  console.warn(
    "[storage] Running on Vercel without DATABASE_URL — the file backend writes to a read-only " +
      "serverless filesystem and will fail. Add a Neon Postgres integration to provide DATABASE_URL.",
  );
}

let sql: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

async function getSql(): Promise<NeonQueryFunction<false, false>> {
  if (!sql) {
    sql = neon(databaseUrl);
  }
  if (!schemaReady) {
    schemaReady = sql`
      CREATE TABLE IF NOT EXISTS kv_store (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `.then(() => undefined);
  }
  await schemaReady;
  return sql;
}

export interface DocStore<T> {
  read(): Promise<T>;
  write(value: T): Promise<void>;
  withLock<R>(fn: () => Promise<R>): Promise<R>;
}

// A JSON document persisted either as a local file (zero-config dev) or as one row in
// Postgres `kv_store` (Vercel/Neon), keyed per-browser tenant so concurrent public visitors
// get isolated state instead of sharing one global document. The same-instance lock
// serializes read-modify-write within a process; cross-instance writes are last-write-wins.
export function createDocStore<T>(opts: {
  fileName: string;
  pgKey: string;
  empty: () => T;
}): DocStore<T> {
  let chain: Promise<unknown> = Promise.resolve();
  const withLock = <R>(fn: () => Promise<R>): Promise<R> => {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  if (storageBackend === "file") {
    const fileFor = async () =>
      path.join(process.cwd(), `${opts.fileName}.${await getTenantId()}`);
    return {
      withLock,
      async read() {
        try {
          return JSON.parse(await fs.readFile(await fileFor(), "utf8")) as T;
        } catch {
          return opts.empty();
        }
      },
      async write(value) {
        const file = await fileFor();
        const tmp = `${file}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
        await fs.rename(tmp, file);
      },
    };
  }

  return {
    withLock,
    async read() {
      const db = await getSql();
      const key = `${opts.pgKey}:${await getTenantId()}`;
      const rows = (await db`SELECT value FROM kv_store WHERE key = ${key}`) as {
        value: T;
      }[];
      return rows[0]?.value ?? opts.empty();
    },
    async write(value) {
      const db = await getSql();
      const key = `${opts.pgKey}:${await getTenantId()}`;
      await db`
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      `;
    },
  };
}
