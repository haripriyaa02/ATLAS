"use client";

import { useState, useRef, useCallback } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

interface BatchMetrics {
  inference_time_ms: number;
  road_percentage: number;
  avg_confidence: number;
  image_size: [number, number];
}

interface BatchResult {
  filename: string;
  original: string;
  mask: string;
  overlay: string;
  metrics: BatchMetrics;
}

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((fileList: FileList) => {
    const imgs = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    setFiles(imgs);
    setResults(null);
    setError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const runBatch = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const res = await fetch(`${API}/predict/batch?threshold=${threshold}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResults(data.results);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Batch processing failed");
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!results) return;
    const headers = "filename,inference_ms,road_percentage,avg_confidence,width,height\n";
    const rows = results
      .map((r) => `${r.filename},${r.metrics.inference_time_ms},${r.metrics.road_percentage},${r.metrics.avg_confidence},${r.metrics.image_size[0]},${r.metrics.image_size[1]}`)
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas_batch_results.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /* summary stats */
  const avgTime = results ? (results.reduce((s, r) => s + r.metrics.inference_time_ms, 0) / results.length).toFixed(0) : 0;
  const avgRoad = results ? (results.reduce((s, r) => s + r.metrics.road_percentage, 0) / results.length).toFixed(1) : 0;
  const avgConf = results ? (results.reduce((s, r) => s + r.metrics.avg_confidence, 0) / results.length).toFixed(1) : 0;

  return (
    <div className="segment-page">
      <div className="page-header">
        <h1>
          📦 Batch <span className="gradient-text">Processing</span>
        </h1>
        <p>Upload multiple road images and get segmentation results + a CSV report.</p>
      </div>

      {/* Upload */}
      {files.length === 0 && (
        <div
          className={`upload-zone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="upload-icon">📁</div>
          <h3>Drop multiple road images here</h3>
          <p>or <span className="browse-link">browse files</span> · Select multiple images</p>
          <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }} />
        </div>
      )}

      {files.length > 0 && !results && (
        <>
          <div className="preview-bar">
            <div className="preview-info" style={{ flex: 1 }}>
              <div className="filename">{files.length} images selected</div>
              <div className="filesize">{files.map((f) => f.name).join(", ")}</div>
            </div>
            <button className="btn btn-secondary" style={{ padding: "8px 16px", fontSize: "0.8rem" }} onClick={() => setFiles([])}>✕ Clear</button>
          </div>
          <div className="controls-row">
            <div className="control-group">
              <label>Threshold <span className="threshold-value">{threshold.toFixed(2)}</span></label>
              <input type="range" min="0.1" max="0.9" step="0.05" value={threshold} className="threshold-slider" onChange={(e) => setThreshold(parseFloat(e.target.value))} />
            </div>
            <button className="btn btn-primary" onClick={runBatch} disabled={loading} style={{ height: 46 }}>
              {loading ? "⏳ Processing..." : `🚀 Process ${files.length} Images`}
            </button>
          </div>
        </>
      )}

      {error && <div className="error-banner">⚠️ {error}</div>}
      {loading && <div className="loading-container"><div className="spinner" /><div className="loading-text">Processing {files.length} images…</div></div>}

      {/* Results */}
      {results && !loading && (
        <div className="batch-results">
          {/* Summary */}
          <div className="batch-summary">
            <div className="summary-stat"><div className="summary-value">{results.length}</div><div className="summary-label">Images</div></div>
            <div className="summary-stat"><div className="summary-value">{avgTime}ms</div><div className="summary-label">Avg Inference</div></div>
            <div className="summary-stat"><div className="summary-value">{avgRoad}%</div><div className="summary-label">Avg Road %</div></div>
            <div className="summary-stat"><div className="summary-value">{avgConf}%</div><div className="summary-label">Avg Confidence</div></div>
          </div>

          <div className="download-row" style={{ marginBottom: 24 }}>
            <button className="btn-download" onClick={downloadCSV}>📊 Download CSV Report</button>
            <button className="btn btn-secondary" style={{ padding: "10px 20px", fontSize: "0.82rem" }} onClick={() => { setFiles([]); setResults(null); }}>🔄 New Batch</button>
          </div>

          {results.map((r, i) => (
            <div key={i} className="batch-item">
              <img src={`data:image/png;base64,${r.overlay}`} alt={r.filename} className="batch-thumb" />
              <div className="batch-info">
                <div className="batch-name">{r.filename}</div>
                <div className="batch-metrics">
                  <span>⏱️ <strong>{r.metrics.inference_time_ms}ms</strong></span>
                  <span>🛣️ <strong>{r.metrics.road_percentage}%</strong> road</span>
                  <span>🎯 <strong>{r.metrics.avg_confidence}%</strong> conf</span>
                  <span>📐 {r.metrics.image_size[0]}×{r.metrics.image_size[1]}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
