"use client";

/**
 * WorkspaceShell — 260px 左侧阶段进度栏 + 右侧主内容。
 * Story Workspace / Episode Workspace 共用。
 *
 * 使用方式：
 *   const stages = computeWorkspaceStages({ project, bible, episodes, active: "story_setting" });
 *   <WorkspaceShell stages={stages} title="Story Workspace" subtitle="...">{...}</WorkspaceShell>
 *
 * P0-1 (workflow-refactor v1)
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type { ComputedStage } from "./workspace-stages";

export interface WorkspaceShellProps {
  stages: ComputedStage[];
  title: string;
  subtitle?: ReactNode;
  /** 主内容区顶部 chip 行（合规 / 类型 / 内容形态 等） */
  meta?: ReactNode;
  children: ReactNode;
}

const STATUS_EMOJI: Record<string, string> = {
  todo: "○",
  in_progress: "◐",
  done: "●",
};

export function WorkspaceShell(props: WorkspaceShellProps) {
  const { stages, title, subtitle, meta, children } = props;

  return (
    <div className="workspace">
      <aside className="workspace-stagebar">
        <div className="workspace-stagebar-header">
          <div className="workspace-stagebar-eyebrow">当前流程</div>
          <div className="workspace-stagebar-title">6 步流水线</div>
        </div>
        <ol className="stage-list">
          {stages.map((s) => {
            const clickable = !!s.href && s.status !== "in_progress";
            const inner = (
              <>
                <span className={`stage-dot stage-dot-${s.status}`}>
                  {STATUS_EMOJI[s.status] ?? "○"}
                </span>
                <span className="stage-body">
                  <span className="stage-index">Step {s.index}</span>
                  <span className="stage-label">{s.label}</span>
                  {s.hint && <span className="stage-hint">{s.hint}</span>}
                </span>
              </>
            );
            return (
              <li key={s.key} className={`stage-item stage-item-${s.status}`}>
                {clickable && s.href ? (
                  <Link href={s.href} className="stage-link">
                    {inner}
                  </Link>
                ) : (
                  <div
                    className="stage-link stage-link-static"
                    title={
                      s.href
                        ? "当前所在阶段"
                        : "该阶段暂不可直接跳转（如需先选一集）"
                    }
                  >
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <div className="workspace-stagebar-footer">
          <span className="muted" style={{ fontSize: 11 }}>
            ● 已完成 · ◐ 进行中 · ○ 待完成
          </span>
        </div>
      </aside>
      <main className="workspace-main">
        <header className="page-header">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            {subtitle && <div className="subtitle">{subtitle}</div>}
          </div>
          {meta && <div style={{ display: "flex", gap: 8 }}>{meta}</div>}
        </header>
        {children}
      </main>
    </div>
  );
}
