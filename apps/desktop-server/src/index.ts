/**
 * Desktop server entry — creates the SQLite registry, boots services, starts
 * the Hono app on the configured port. Configuration is entirely env-driven so
 * the desktop shell can override defaults per install.
 *
 * Env:
 *   DRAMAFLOW_DB      SQLite file path or ":memory:" (default: ./dramaflow.sqlite3)
 *   DRAMAFLOW_PORT    HTTP port (default 5174)
 *   DRAMAFLOW_ACTOR   Attribution string for activity events (default "local")
 */

import { serve } from "@hono/node-server";
import { createSqliteRepositoryRegistry } from "@dramaflow/repositories";
import { createServiceBundle } from "./services.js";
import { createApp } from "./server.js";
import { loadPersistedAiConfig } from "./routes/ai.js";
import { serverLog, getLogRoot } from "./logger.js";

// Node 级兜底：任何未捕获的异常 / promise 拒绝都进 server.log。
// 目的：即使 Hono onError 因某种原因没触发（例如错误发生在异步微任务外、
// 或者 Node 底层库抛出），也能在 .runtime/logs/server.<date>.log 留痕。
process.on("uncaughtException", (err) => {
  serverLog.error("process.uncaughtException", { err });
});
process.on("unhandledRejection", (reason) => {
  serverLog.error("process.unhandledRejection", {
    reason: reason instanceof Error ? reason : { value: String(reason) },
  });
});

function readEnv(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.length > 0 ? v : fallback;
}

async function main(): Promise<void> {
  const dbFile = readEnv("DRAMAFLOW_DB", "./dramaflow.sqlite3");
  const port = Number(readEnv("DRAMAFLOW_PORT", "5174"));
  const actor = readEnv("DRAMAFLOW_ACTOR", "local");

  const { registry, migration } = createSqliteRepositoryRegistry({ filename: dbFile });
  const appliedList = migration?.applied.join(",") || "(none)";
  // eslint-disable-next-line no-console
  console.log(`[desktop-server] DB=${dbFile} migrations=${appliedList}`);

  // Load persisted AI config (Web UI 保存的 ARK_API_KEY) 到 runtime override。
  const aiPersist = await loadPersistedAiConfig();
  if (aiPersist.loaded) {
    // eslint-disable-next-line no-console
    console.log(`[desktop-server] AI provider key loaded from .runtime/ai.env`);
  }

  const services = createServiceBundle(registry, actor);
  const app = createApp({ services });

  serve(
    { fetch: app.fetch, port, hostname: "127.0.0.1" },
    (info) => {
      // eslint-disable-next-line no-console
      console.log(`[desktop-server] listening on http://${info.address}:${info.port}`);
      serverLog.info("process.started", {
        address: info.address,
        port: info.port,
        dbFile,
        migrations: appliedList,
        logRoot: getLogRoot(),
        pid: process.pid,
      });
    },
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[desktop-server] fatal:", err);
  process.exit(1);
});
