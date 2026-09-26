"use client";

/**
 * ProjectPicker — lightweight project selector persisted to localStorage.
 * Renders a <select> populated from GET /api/projects and calls onChange when
 * the user picks. Used by every module page that scopes data to one project.
 */
import { useEffect, useState } from "react";
import { projects, type Project } from "./api";

const LS_KEY = "dramaflow:selectedProjectId";

export function useSelectedProject(): [string | null, (id: string) => void] {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(LS_KEY);
    if (v) setId(v);
  }, []);
  const set = (v: string) => {
    setId(v);
    if (typeof window !== "undefined") window.localStorage.setItem(LS_KEY, v);
  };
  return [id, set];
}

export function ProjectPicker(props: { value: string | null; onChange: (id: string) => void }) {
  const [items, setItems] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    projects
      .list()
      .then((r) => setItems(r.items))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="form-row" style={{ maxWidth: 480 }}>
      <label>项目</label>
      <select
        value={props.value || ""}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="" disabled>
          — 选择项目 —
        </option>
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.slug})
          </option>
        ))}
      </select>
      {err && <div className="error">{err}</div>}
    </div>
  );
}
