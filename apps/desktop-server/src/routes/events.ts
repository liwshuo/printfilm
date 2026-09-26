/**
 * SSE event stream (adr-002 §7). Clients subscribe to `/api/events` and
 * optionally filter by projectId via query. First payload is `retry: 10000`
 * to hint reconnect interval; a heartbeat comment is sent every 20s to keep
 * intermediaries happy.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { AppEnv } from "../env.js";
import { subscribe } from "../events.js";

export function eventsRouter(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get("/events", (c) => {
    const projectId = c.req.query("projectId") || undefined;
    return streamSSE(c, async (stream) => {
      const { events, unsubscribe } = subscribe(projectId);
      stream.onAbort(() => unsubscribe());
      // Retry hint + hello
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ projectId }), retry: 10000 });
      // Heartbeat loop
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: JSON.stringify({ ts: Date.now() }) }).catch(() => {
          clearInterval(heartbeat);
        });
      }, 20000);
      try {
        for await (const evt of events) {
          await stream.writeSSE({
            event: evt.topic,
            data: JSON.stringify(evt),
          });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  return r;
}
