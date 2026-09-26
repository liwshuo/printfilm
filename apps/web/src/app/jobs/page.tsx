"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { ProjectPicker, useSelectedProject } from "@/lib/project-picker";

interface Job {
  id: string;
  taskType: string;
  status: string;
  sourceEntityType: string;
  sourceEntityId: string;
  attempt: number;
  createdAt: string;
  finishedAt?: string;
}

const STATUS_PILL: Record<string, string> = {
  queued: "warn",
  running: "warn",
  succeeded: "ok",
  failed: "danger",
  cancelled: "",
};

export default function JobsPage() {
  const [projectId, setProjectId] = useSelectedProject();
  const [items, setItems] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const res = await api.get<{ items: Job[] }>(`/api/projects/${projectId}/jobs`);
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, [projectId]);

  useEffect(() => {
    load();
    if (!projectId) return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load, projectId]);

  async function retry(job: Job) {
    setError(null);
    try {
      await api.post(`/api/jobs/${job.id}/retry`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }
  async function cancel(job: Job) {
    setError(null);
    try {
      await api.post(`/api/jobs/${job.id}/cancel`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <>
      <header className="page-header">
        <h2>Production Hub</h2>
        <span className="subtitle">GenerationTask 编排 · 状态 · 重试 / 取消</span>
      </header>
      <ProjectPicker value={projectId} onChange={setProjectId} />
      {error && <div className="error">{error}</div>}

      <section className="card">
        <h3>任务列表</h3>
        {items.length === 0 ? (
          <div className="muted">还没有任务。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Source</th>
                <th>状态</th>
                <th>尝试</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((j) => (
                <tr key={j.id}>
                  <td>
                    <code>{j.taskType}</code>
                  </td>
                  <td>
                    <code>
                      {j.sourceEntityType}:{j.sourceEntityId.slice(0, 8)}
                    </code>
                  </td>
                  <td>
                    <span className={"pill " + (STATUS_PILL[j.status] || "")}>{j.status}</span>
                  </td>
                  <td>#{j.attempt}</td>
                  <td className="muted">{j.createdAt}</td>
                  <td>
                    {j.status === "failed" && (
                      <button className="btn secondary" onClick={() => retry(j)}>
                        重试
                      </button>
                    )}
                    {(j.status === "queued" || j.status === "running") && (
                      <button className="btn secondary" onClick={() => cancel(j)}>
                        取消
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
