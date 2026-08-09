import React, { useState } from "react";
import { getSubmissionStatus } from "../lib/supabase";

export default function SubmissionStatus({ onClose }) {
  const [code, setCode] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const query = async () => {
    setError("");
    setResult(null);
    try {
      setResult(await getSubmissionStatus(code));
    } catch (queryError) {
      setError(queryError.message || "查询失败");
    }
  };
  return (
    <aside className="debug-panel status-panel">
      <div className="drawer-heading">
        <div>
          <p className="section-kicker">SUBMISSION STATUS</p>
          <h2>查询投稿</h2>
        </div>
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="关闭查询"
        >
          ×
        </button>
      </div>
      <div className="debug-form">
        <label>
          <span>查询码</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="输入提交后获得的查询码"
          />
        </label>
        <button className="copy-yaml" onClick={query} disabled={!code.trim()}>
          查询状态
        </button>
        {error && <p className="form-error">{error}</p>}
        {result && (
          <div className="status-result">
            <strong>
              {result.status === "pending"
                ? "审核中"
                : result.status === "approved"
                  ? "已通过"
                  : "已驳回"}
            </strong>
            {result.rejection_reason && <p>{result.rejection_reason}</p>}
            <small>{new Date(result.submitted_at).toLocaleString()}</small>
          </div>
        )}
        {result === null && !error && code && (
          <p className="form-muted">没有找到对应投稿。</p>
        )}
      </div>
    </aside>
  );
}
