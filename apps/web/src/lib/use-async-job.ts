"use client";

/**
 * useAsyncJob — 后台 LLM job 的 React hook 封装。
 *
 * 使命：让 UI 组件不用关心「同步 vs 异步 / 起 / 停 / 轮询 / resume / 取消」这些琐事。
 *
 * 典型用法（拆段落）：
 *
 *   const job = useAsyncJob({
 *     entityType: "episode",
 *     entityId: episodeId,
 *     onDone: async () => {
 *       const res = await storyboards.listScenes(episodeId);
 *       setScenes(res.items);
 *     },
 *   });
 *
 *   // 触发
 *   const trigger = () => job.start(async () => {
 *     const ticket = await storyboards.generateScenes(episodeId);
 *     return ticket.taskId;
 *   });
 *
 *   // UI
 *   job.status === "running"    // 显示 loading
 *   job.error                    // 显示错误
 *
 * 页面 mount 时，hook 会自动 `jobs.listBySource(entityType, entityId, ["queued","running"])`
 * 检查该实体是否已有在跑的 job，如果有就无缝续接（不用重新触发），跑完照常 fire `onDone`。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, jobs, pollJob, type AsyncJob, type AsyncJobStatus } from "./api";

export type AsyncJobUiStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";

export interface UseAsyncJobOpts {
  /** 实体类型，用于 resume 查询。传 undefined 时不开启 resume。 */
  entityType?: string;
  /** 实体 ID */
  entityId?: string;
  /** 任务终态为 succeeded 时的回调；一般用来 refetch 目标实体。 */
  onDone?: (job: AsyncJob) => void | Promise<void>;
  /** 若 hook 挂载时发现一个 job 处于 queued/running，是否自动 resume。默认 true。 */
  resumeOnMount?: boolean;
  /** 轮询间隔，默认 1500ms。 */
  intervalMs?: number;
  /** 只关注这些 taskType 的 job。默认不过滤。 */
  taskTypeFilter?: readonly string[];
}

export interface UseAsyncJobReturn {
  status: AsyncJobUiStatus;
  job: AsyncJob | null;
  taskId: string | null;
  error: string | null;
  /**
   * 触发一个新 job。`enqueue` 应发起 POST 并返回 taskId（一般直接用 API client 返回的 ticket.taskId）。
   * 已经在跑时会拒绝二次触发（防抖）。
   */
  start: (enqueue: () => Promise<string>) => Promise<void>;
  /** 取消当前正在跑的 job。 */
  cancel: () => Promise<void>;
  /** 手动清空错误 / 状态，回到 idle。 */
  reset: () => void;
}

export function useAsyncJob(opts: UseAsyncJobOpts): UseAsyncJobReturn {
  const [status, setStatus] = useState<AsyncJobUiStatus>("idle");
  const [job, setJob] = useState<AsyncJob | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;

  const stopPolling = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runPoll = useCallback(
    async (id: string) => {
      stopPolling();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStatus("running");
      setTaskId(id);
      setError(null);
      try {
        const final = await pollJob(id, {
          signal: ctrl.signal,
          intervalMs: opts.intervalMs,
          onTick: (j) => setJob(j),
        });
        if (ctrl.signal.aborted) return;
        setJob(final);
        if (final.status === "succeeded") {
          setStatus("succeeded");
          try {
            await onDoneRef.current?.(final);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        } else if (final.status === "cancelled") {
          setStatus("cancelled");
        } else {
          setStatus("failed");
          setError(final.errorMessage || final.errorCode || "任务失败");
        }
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setStatus("failed");
        setError(
          err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
        );
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [opts.intervalMs, stopPolling],
  );

  const start = useCallback(
    async (enqueue: () => Promise<string>) => {
      if (status === "running") return; // 防抖：已有 job 在跑就不重复触发
      setStatus("running");
      setError(null);
      try {
        const id = await enqueue();
        await runPoll(id);
      } catch (err) {
        setStatus("failed");
        setError(
          err instanceof ApiError ? `${err.code}: ${err.message}` : String(err),
        );
      }
    },
    [runPoll, status],
  );

  const cancel = useCallback(async () => {
    const id = taskId;
    stopPolling();
    if (!id) {
      setStatus("idle");
      return;
    }
    try {
      const j = await jobs.cancel(id);
      setJob(j);
      setStatus("cancelled");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [stopPolling, taskId]);

  const reset = useCallback(() => {
    stopPolling();
    setStatus("idle");
    setJob(null);
    setTaskId(null);
    setError(null);
  }, [stopPolling]);

  // Resume on mount
  const resumeOnMount = opts.resumeOnMount ?? true;
  const entityType = opts.entityType;
  const entityId = opts.entityId;
  const taskTypeFilter = opts.taskTypeFilter;
  useEffect(() => {
    if (!resumeOnMount || !entityType || !entityId) return;
    let disposed = false;
    (async () => {
      try {
        const running: AsyncJobStatus[] = ["queued", "running"];
        const { items } = await jobs.listBySource(entityType, entityId, running);
        if (disposed || items.length === 0) return;
        const target = taskTypeFilter
          ? items.find((j) => taskTypeFilter.includes(j.taskType))
          : items[0];
        if (!target) return;
        // 发现有在跑的 job → 自动接管
        setJob(target);
        await runPoll(target.id);
      } catch {
        // resume 失败不影响首屏；忽略。
      }
    })();
    return () => {
      disposed = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, resumeOnMount]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { status, job, taskId, error, start, cancel, reset };
}
