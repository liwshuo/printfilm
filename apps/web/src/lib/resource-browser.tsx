"use client";

/**
 * ResourceBrowser — reusable per-module viewer.
 * Given a project-scoped list endpoint, renders the response items as a
 * pretty-printed JSON pane. Keeps the workbench honest until dedicated
 * editors are built out per module.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

interface Props {
  projectId: string | null;
  /** e.g. (id) => `/api/projects/${id}/artifacts` */
  buildUrl: (projectId: string) => string;
  emptyHint?: string;
  itemRenderer?: (item: unknown, index: number) => React.ReactNode;
}

export function ResourceBrowser(props: Props) {
  const { projectId, buildUrl, emptyHint, itemRenderer } = props;
  const [items, setItems] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: unknown[] }>(buildUrl(projectId));
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId, buildUrl]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (!projectId) return <div className="muted">先选择一个项目。</div>;
  if (loading) return <div className="muted">加载中…</div>;
  if (error) return <div className="error">{error}</div>;
  if (!items || items.length === 0) {
    return (
      <div className="muted">
        {emptyHint || "暂无数据。"} <button className="btn secondary" onClick={reload}>刷新</button>
      </div>
    );
  }
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <button className="btn secondary" onClick={reload}>
          刷新（共 {items.length} 条）
        </button>
      </div>
      {itemRenderer ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((it, i) => (
            <li key={i} className="card" style={{ marginBottom: 8 }}>
              {itemRenderer(it, i)}
            </li>
          ))}
        </ul>
      ) : (
        <pre>{JSON.stringify(items, null, 2)}</pre>
      )}
    </>
  );
}
