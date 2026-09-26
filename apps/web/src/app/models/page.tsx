"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, ai, AiProviderStatus, AiVerifyResult } from "@/lib/api";

interface ModelProfile {
  id: string;
  provider: string;
  modelType: string;
  modelName: string;
  isActive: boolean;
  credentialBound: boolean;
  credentialHint?: string;
  version: number;
}

export default function ModelsPage() {
  const [items, setItems] = useState<ModelProfile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState("openai");
  const [modelType, setModelType] = useState<"llm" | "image" | "video" | "tts">("llm");
  const [modelName, setModelName] = useState("");
  const [endpointKey, setEndpointKey] = useState("");

  // Ark provider status
  const [arkStatus, setArkStatus] = useState<AiProviderStatus | null>(null);
  const [arkVerify, setArkVerify] = useState<AiVerifyResult["ping"] | null>(null);
  const [arkBusy, setArkBusy] = useState(false);
  const [arkError, setArkError] = useState<string | null>(null);
  // Ark API Key 输入 / 保存 / 清除
  const [arkKeyInput, setArkKeyInput] = useState("");
  const [arkKeyReveal, setArkKeyReveal] = useState(false);
  const [arkPersist, setArkPersist] = useState(true);
  const [arkSaveMsg, setArkSaveMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<{ items: ModelProfile[] }>("/api/model-profiles/views");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  const loadArkStatus = useCallback(async () => {
    setArkError(null);
    try {
      const s = await ai.status();
      setArkStatus(s);
    } catch (err) {
      setArkError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }, []);

  useEffect(() => {
    load();
    loadArkStatus();
  }, [load, loadArkStatus]);

  async function onVerifyArk() {
    setArkBusy(true);
    setArkError(null);
    setArkVerify(null);
    try {
      const res = await ai.verify();
      setArkStatus(res);
      setArkVerify(res.ping);
    } catch (err) {
      setArkError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setArkBusy(false);
    }
  }

  async function onSaveArkKey() {
    if (!arkKeyInput.trim()) {
      setArkError("请填入 API Key");
      return;
    }
    setArkBusy(true);
    setArkError(null);
    setArkSaveMsg(null);
    setArkVerify(null);
    try {
      const saved = await ai.saveKey(arkKeyInput.trim(), arkPersist);
      setArkStatus(saved);
      setArkKeyInput("");
      setArkKeyReveal(false);
      setArkSaveMsg(
        saved.persisted
          ? "已保存并写入 .runtime/ai.env（重启后仍生效）"
          : "已保存到当前进程内存（重启后失效）",
      );
      // 保存后立即探活，验证 Key 可用性
      const ping = await ai.verify();
      setArkStatus(ping);
      setArkVerify(ping.ping);
    } catch (err) {
      setArkError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setArkBusy(false);
    }
  }

  async function onClearArkKey() {
    if (!confirm("确认清除当前 API Key？（会同时删除 .runtime/ai.env）")) return;
    setArkBusy(true);
    setArkError(null);
    setArkSaveMsg(null);
    setArkVerify(null);
    try {
      const res = await ai.clearKey();
      setArkStatus(res);
      setArkSaveMsg("已清除 API Key");
    } catch (err) {
      setArkError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    } finally {
      setArkBusy(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/model-profiles", {
        provider, modelType, modelName, endpointKey,
        defaultParams: {}, isActive: true,
      });
      setModelName("");
      setEndpointKey("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  async function toggleActive(m: ModelProfile) {
    setError(null);
    try {
      await api.post(`/api/model-profiles/${m.id}/set-active`, {
        isActive: !m.isActive, version: m.version,
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : String(err));
    }
  }

  return (
    <>
      <header className="page-header">
        <h2>Model Settings</h2>
        <span className="subtitle">Model Profile · Provider 凭据</span>
      </header>
      {error && <div className="error">{error}</div>}

      <section className="card">
        <h3>AI Provider · 火山方舟 Ark（默认）</h3>
        {arkError && <div className="error">{arkError}</div>}
        {!arkStatus ? (
          <div className="muted">加载中…</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              状态：
              {arkStatus.ready
                ? <span className="pill ok">ready</span>
                : <span className="pill warn">未配置 API Key</span>}
              <span style={{ marginLeft: 8 }} className="muted">
                provider = <code>{arkStatus.provider}</code>
                {arkStatus.keySource ? <> · key = <code>{arkStatus.keySource}</code></> : null}
                {arkStatus.keyPreview ? <> · <code>{arkStatus.keyPreview}</code></> : null}
              </span>
            </div>
            <div className="muted">
              baseUrl：<code>{arkStatus.baseUrl}</code>
            </div>
            <div className="muted">
              默认模型：chat=<code>{arkStatus.defaultModels.chat}</code> · image=<code>{arkStatus.defaultModels.image}</code> · video=<code>{arkStatus.defaultModels.video}</code>
            </div>
            {arkStatus.hint && <div className="muted">提示：{arkStatus.hint}</div>}

            <div style={{ borderTop: "1px solid #eee", marginTop: 8, paddingTop: 8 }}>
              <div className="form-row">
                <label>ARK_API_KEY</label>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    style={{ flex: 1, fontFamily: "monospace" }}
                    type={arkKeyReveal ? "text" : "password"}
                    placeholder={arkStatus.ready ? "已有 Key，填入新值可覆盖" : "粘贴火山方舟 Ark API Key"}
                    value={arkKeyInput}
                    onChange={(e) => setArkKeyInput(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setArkKeyReveal((v) => !v)}
                  >
                    {arkKeyReveal ? "隐藏" : "显示"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={arkPersist}
                    onChange={(e) => setArkPersist(e.target.checked)}
                  />
                  <span>持久化到 <code>.runtime/ai.env</code>（重启后仍生效）</span>
                </label>
                <button
                  type="button"
                  className="btn"
                  disabled={arkBusy || !arkKeyInput.trim()}
                  onClick={onSaveArkKey}
                >
                  {arkBusy ? "保存中…" : "保存并验证"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={arkBusy || !arkStatus.ready}
                  onClick={onVerifyArk}
                >
                  {arkBusy ? "探活中…" : "只探活现有 Key"}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={arkBusy || !arkStatus.ready}
                  onClick={onClearArkKey}
                >
                  清除 Key
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={loadArkStatus}
                >
                  刷新状态
                </button>
              </div>
              {arkSaveMsg && <div className="muted" style={{ marginTop: 6 }}>{arkSaveMsg}</div>}
            </div>

            {arkVerify && (
              <div>
                探活结果：
                {arkVerify.ok
                  ? <span className="pill ok">ok · {arkVerify.modelId} · {arkVerify.finishReason || "stop"}</span>
                  : <span className="pill err">failed · {arkVerify.status || ""} · {arkVerify.error}</span>}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>新增模型档案</h3>
        <form onSubmit={onCreate}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
            <div className="form-row">
              <label>Provider</label>
              <input value={provider} onChange={(e) => setProvider(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Type</label>
              <select value={modelType} onChange={(e) => setModelType(e.target.value as "llm" | "image" | "video" | "tts")}>
                <option value="llm">llm</option>
                <option value="image">image</option>
                <option value="video">video</option>
                <option value="tts">tts</option>
              </select>
            </div>
            <div className="form-row">
              <label>Model Name</label>
              <input value={modelName} onChange={(e) => setModelName(e.target.value)} required />
            </div>
            <div className="form-row">
              <label>Endpoint Key</label>
              <input value={endpointKey} onChange={(e) => setEndpointKey(e.target.value)} />
            </div>
          </div>
          <button className="btn" type="submit">创建</button>
        </form>
      </section>
      <section className="card">
        <h3>已配置</h3>
        {items.length === 0 ? (
          <div className="muted">还没有模型档案。</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Provider / Model</th><th>Type</th><th>Credential</th><th>状态</th><th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td><strong>{m.provider}</strong> · {m.modelName}</td>
                  <td><code>{m.modelType}</code></td>
                  <td>
                    {m.credentialBound
                      ? <span className="pill ok">bound {m.credentialHint || ""}</span>
                      : <span className="pill warn">未配置</span>}
                  </td>
                  <td>
                    <span className={"pill " + (m.isActive ? "ok" : "")}>
                      {m.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  <td>
                    <button className="btn secondary" onClick={() => toggleActive(m)}>
                      {m.isActive ? "停用" : "启用"}
                    </button>
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
