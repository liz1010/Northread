import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import * as schema from "./schema.ts";

const dbPath = process.env.NORTHREAD_DB ?? "./data/northread.db";
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
// WAL 让读写不互相阻塞：抓取脚本在后台写的同时，网页还能读。
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };
