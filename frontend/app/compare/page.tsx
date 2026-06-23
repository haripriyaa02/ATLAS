"use client";

import { useState, useRef, useCallback } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

interface MethodResult {
  key: string;
  label: string;
  description: string;
  mask: string;
  overlay: string;
  time_ms: number;
  road_percentage: number;
}

type ShowMode = "overlay" | "mask";

export default function ComparePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [methods, setMethods] = useState<MethodResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMode, setShowMode] = useState<ShowMode>("overlay");
  const [threshold, setThreshold] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setMethods(null);
    setError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f && f.type.startsWith("image/")) handleFile(f);
    },
    [handleFile]
  );

  const runCompare = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/compare?threshold=${threshold}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMethods(data.methods);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="segment-page">
      <div className="page-header">
        <h1>
          ⚔️ Method <span className="gradient-text">Compare</span>
        </h1>
        <p>
          See how the UNet deep learning model stacks up against 5 classical
          thresholding techniques — on your image.
        </p>
      </div>

      {/* Upload */}
      {!preview && (
        <div
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="upload-icon">📷</div>
          <h3>Drop a road image to compare all methods</h3>
          <p>or <span className="browse-link">browse files</span> · JPG, PNG</p>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {preview && (
        <>
          <div className="preview-bar">
            <img src={preview} alt="preview" className="preview-thumb" />
            <div className="preview-info">
              <div className="filename">{file?.name}</div>
              <div className="filesize">{file ? (file.size / 1024).toFixed(1) + " KB" : ""}</div>
            </div>
            <button className="btn btn-secondary" style={{ padding: "8px 16px", fontSize: "0.8rem" }} onClick={() => { setFile(null); setPreview(null); setMethods(null); }}>✕ Clear</button>
          </div>

          <div className="controls-row" style={{ marginTop: 24 }}>
            <div className="control-group">
              <label>UNet Threshold <span className="threshold-value">{threshold.toFixed(2)}</span></label>
              <input type="range" min="0.1" max="0.9" step="0.05" value={threshold} className="threshold-slider" onChange={(e) => setThreshold(parseFloat(e.target.value))} />
            </div>
            <button className="btn btn-primary" onClick={runCompare} disabled={loading} style={{ height: 46 }}>
              {loading ? "⏳ Running..." : "⚔️ Compare All"}
            </button>
          </div>
        </>
      )}

      {error && <div className="error-banner">⚠️ {error}</div>}
      {loading && <div className="loading-container"><div className="spinner" /><div className="loading-text">Running UNet + 5 classical methods…</div></div>}

      {/* Results */}
      {methods && !loading && (
        <>
          {/* Toggle overlay/mask */}
          <div className="compare-toggle">
            <button className={`results-tab ${showMode === "overlay" ? "active" : ""}`} onClick={() => setShowMode("overlay")}>🎨 Overlay</button>
            <button className={`results-tab ${showMode === "mask" ? "active" : ""}`} onClick={() => setShowMode("mask")}>🖤 Mask</button>
          </div>

          <div className="compare-grid">
            {methods.map((m) => (
              <div key={m.key} className={`compare-card ${m.key === "unet" ? "best" : ""}`}>
                <img
                  src={`data:image/png;base64,${showMode === "overlay" ? m.overlay : m.mask}`}
                  alt={m.label}
                  className="card-image"
                />
                <div className="card-body">
                  <div className="card-title">
                    {m.label}
                    {m.key === "unet" && <span className="badge badge-purple">Best</span>}
                  </div>
                  <div className="card-desc">{m.description}</div>
                  <div className="card-stats">
                    <span>⏱️ <strong>{m.time_ms}ms</strong></span>
                    <span>🛣️ <strong>{m.road_percentage}%</strong> road</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
