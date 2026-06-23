"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

/* ---------- types ---------- */
interface Metrics {
  inference_time_ms: number;
  road_percentage: number;
  road_pixels: number;
  total_pixels: number;
  avg_confidence: number;
  threshold: number;
  image_size: [number, number];
}
interface PredictionResult {
  original: string;
  mask: string;
  overlay: string;
  heatmap: string;
  metrics: Metrics;
}
interface PipelineStep {
  name: string;
  image: string;
  description: string;
}
interface ThresholdItem {
  threshold: number;
  mask: string;
  overlay: string;
  road_percentage: number;
}
interface HistoryEntry {
  id: number;
  filename: string;
  overlay: string;
  result: PredictionResult;
}

type ViewTab = "overlay" | "mask" | "original" | "heatmap";

export default function SegmentPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>("overlay");

  /* pipeline */
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[] | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);

  /* threshold grid */
  const [thresholdGrid, setThresholdGrid] = useState<ThresholdItem[] | null>(null);
  const [tgLoading, setTgLoading] = useState(false);

  /* history */
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const nextId = useRef(0);

  /* canvas */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(15);
  const [gtMetrics, setGtMetrics] = useState<{ iou: number; dice: number; accuracy: number } | null>(null);

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ---------- helpers ---------- */
  const handleFile = useCallback((f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setPipelineSteps(null);
    setThresholdGrid(null);
    setGtMetrics(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f && f.type.startsWith("video/")) {
        router.push("/video");
        return;
      }
      if (f && f.type.startsWith("image/")) handleFile(f);
    },
    [handleFile, router]
  );

  /* ---------- prediction ---------- */
  const runPrediction = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/predict?threshold=${threshold}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data: PredictionResult = await res.json();
      setResult(data);
      setActiveTab("overlay");
      setHistory((prev) => [
        { id: nextId.current++, filename: file.name, overlay: data.overlay, result: data },
        ...prev,
      ]);

      // Auto-save to DB if authenticated
      if (session) {
        fetch("/api/segmentation/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            threshold: data.metrics.threshold,
            road_percentage: data.metrics.road_percentage,
            avg_confidence: data.metrics.avg_confidence,
            inference_time_ms: data.metrics.inference_time_ms,
            image_width: data.metrics.image_size[0],
            image_height: data.metrics.image_size[1],
            overlay_b64: data.overlay,
            mask_b64: data.mask,
          }),
        }).catch(() => { /* silent */ });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  };

  /* ---------- pipeline ---------- */
  const runPipeline = async () => {
    if (!file) return;
    setPipelineLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/pipeline?threshold=${threshold}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPipelineSteps(data.steps);
    } catch {
      /* silent */
    } finally {
      setPipelineLoading(false);
    }
  };

  /* ---------- threshold grid ---------- */
  const runThresholdGrid = async () => {
    if (!file) return;
    setTgLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/threshold-grid`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setThresholdGrid(data.results);
    } catch {
      /* silent */
    } finally {
      setTgLoading(false);
    }
  };

  /* ---------- download ---------- */
  const downloadZip = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/download?threshold=${threshold}`, {
      method: "POST",
      body: form,
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas_results.zip";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadSingle = (base64: string, name: string) => {
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${base64}`;
    a.download = name;
    a.click();
  };

  /* ---------- canvas drawing ---------- */
  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new window.Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/png;base64,${result.original}`;
  }, [result]);

  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const { x, y } = getCanvasCoords(e);
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();
  };

  const clearCanvas = () => {
    if (!canvasRef.current || !result) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setGtMetrics(null);
  };

  const computeGtMetrics = async () => {
    if (!canvasRef.current || !result) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const form = new FormData();
      // send prediction mask
      const maskBlob = await fetch(`data:image/png;base64,${result.mask}`).then((r) => r.blob());
      form.append("predicted", maskBlob, "predicted.png");
      form.append("ground_truth", blob, "ground_truth.png");
      try {
        const res = await fetch(`${API}/compute-metrics`, { method: "POST", body: form });
        if (res.ok) setGtMetrics(await res.json());
      } catch {
        /* silent */
      }
    }, "image/png");
  };

  /* ---------- tab image ---------- */
  const tabImage = result
    ? activeTab === "overlay"
      ? result.overlay
      : activeTab === "mask"
      ? result.mask
      : activeTab === "heatmap"
      ? result.heatmap
      : result.original
    : null;

  /* ---------- render ---------- */
  return (
    <div className="segment-page">
      <div className="page-header">
        <h1>
          🔍 Road <span className="gradient-text">Segmentation</span>
        </h1>
        <p>Upload a road image and let ATLAS segment it in real time.</p>
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
          <h3>Drop your road image or video here</h3>
          <p>or <span className="browse-link">browse files</span> · JPG, PNG, MP4, AVI supported</p>
          <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { if (f.type.startsWith("video/")) { router.push("/video"); return; } handleFile(f); } }} />
        </div>
      )}

      {/* Preview + controls */}
      {preview && (
        <>
          <div className="preview-bar">
            <img src={preview} alt="preview" className="preview-thumb" />
            <div className="preview-info">
              <div className="filename">{file?.name}</div>
              <div className="filesize">{file ? (file.size / 1024).toFixed(1) + " KB" : ""}</div>
            </div>
            <button className="btn btn-secondary" style={{ padding: "8px 16px", fontSize: "0.8rem" }} onClick={() => { setFile(null); setPreview(null); setResult(null); setError(null); setPipelineSteps(null); setThresholdGrid(null); setGtMetrics(null); }}>✕ Clear</button>
          </div>

          <div className="controls-row">
            <div className="control-group">
              <label>Threshold <span className="threshold-value">{threshold.toFixed(2)}</span></label>
              <input type="range" min="0.1" max="0.9" step="0.05" value={threshold} className="threshold-slider" onChange={(e) => setThreshold(parseFloat(e.target.value))} />
            </div>
            <button className="btn btn-primary" onClick={runPrediction} disabled={loading} style={{ height: 46 }}>
              {loading ? "⏳ Processing..." : "🚀 Run Segmentation"}
            </button>
          </div>
        </>
      )}

      {error && <div className="error-banner">⚠️ {error}</div>}
      {loading && <div className="loading-container"><div className="spinner" /><div className="loading-text">Running ATLAS inference…</div></div>}

      {/* ===== RESULTS ===== */}
      {result && !loading && (
        <div className="results-section">
          {/* Tabs */}
          <div className="results-tabs">
            {(["overlay", "mask", "heatmap", "original"] as ViewTab[]).map((t) => (
              <button key={t} className={`results-tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                {t === "overlay" ? "🎨 Overlay" : t === "mask" ? "🖤 Mask" : t === "heatmap" ? "🌡️ Heatmap" : "📷 Original"}
              </button>
            ))}
          </div>

          <div className="result-image-container">
            {tabImage && <img src={`data:image/png;base64,${tabImage}`} alt={activeTab} />}
          </div>

          {/* Metrics */}
          <div className="metrics-grid">
            <div className="metric-card"><div className="metric-value cyan">{result.metrics.inference_time_ms.toFixed(0)}ms</div><div className="metric-label">Inference Time</div></div>
            <div className="metric-card"><div className="metric-value green">{result.metrics.road_percentage}%</div><div className="metric-label">Road Coverage</div></div>
            <div className="metric-card"><div className="metric-value purple">{result.metrics.avg_confidence}%</div><div className="metric-label">Avg Confidence</div></div>
            <div className="metric-card"><div className="metric-value amber">{result.metrics.image_size[0]}×{result.metrics.image_size[1]}</div><div className="metric-label">Image Size</div></div>
          </div>

          {/* Download */}
          <div className="download-row">
            <button className="btn-download" onClick={() => downloadSingle(result.mask, "mask.png")}>💾 Mask PNG</button>
            <button className="btn-download" onClick={() => downloadSingle(result.overlay, "overlay.png")}>💾 Overlay PNG</button>
            <button className="btn-download" onClick={() => downloadSingle(result.heatmap, "heatmap.png")}>💾 Heatmap PNG</button>
            <button className="btn-download" onClick={downloadZip}>📦 Download All (ZIP)</button>
          </div>

          {/* ===== PIPELINE VISUALIZER ===== */}
          <div className="section-divider">
            <h2>🔬 Pipeline Visualizer</h2>
            <p>See every step the model takes to segment your image.</p>
            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={runPipeline} disabled={pipelineLoading}>
              {pipelineLoading ? "⏳ Loading..." : "👁️ Show Pipeline Steps"}
            </button>
          </div>
          {pipelineSteps && (
            <div className="pipeline-steps">
              {pipelineSteps.map((step, i) => (
                <div key={i} className="pipeline-step">
                  <img src={`data:image/png;base64,${step.image}`} alt={step.name} className="step-image" />
                  <div className="step-body">
                    <span className="step-number">{i + 1}</span>
                    <span className="step-name">{step.name}</span>
                    <p className="step-desc">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ===== THRESHOLD GRID ===== */}
          <div className="section-divider">
            <h2>🎚️ Threshold Comparison</h2>
            <p>See how different thresholds affect the segmentation result.</p>
            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={runThresholdGrid} disabled={tgLoading}>
              {tgLoading ? "⏳ Loading..." : "📊 Compare Thresholds"}
            </button>
          </div>
          {thresholdGrid && (
            <div className="threshold-grid-results">
              {thresholdGrid.map((item) => (
                <div key={item.threshold} className="threshold-card">
                  <img src={`data:image/png;base64,${item.overlay}`} alt={`t=${item.threshold}`} className="card-image" />
                  <div className="card-footer">
                    <span className="t-val">t = {item.threshold}</span>
                    <span className="road-pct">{item.road_percentage}% road</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ===== GROUND TRUTH CANVAS ===== */}
          <div className="section-divider">
            <h2>✏️ Annotate Ground Truth</h2>
            <p>Draw the actual road area to compute IoU & Dice vs the model prediction.</p>
          </div>
          <div className="canvas-section">
            <div className="canvas-container">
              <canvas
                ref={canvasRef}
                onMouseDown={() => setDrawing(true)}
                onMouseUp={() => setDrawing(false)}
                onMouseLeave={() => setDrawing(false)}
                onMouseMove={draw}
              />
              <div className="canvas-toolbar">
                <button className="tool-btn active">🖌️ Draw</button>
                <span className="separator" />
                <label style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>Brush:</label>
                <input type="range" min="5" max="40" value={brushSize} className="brush-size" onChange={(e) => setBrushSize(parseInt(e.target.value))} />
                <span className="separator" />
                <button className="tool-btn" onClick={clearCanvas}>🗑️ Clear</button>
                <button className="tool-btn" onClick={computeGtMetrics}>📊 Compute Metrics</button>
              </div>
            </div>
            {gtMetrics && (
              <div className="gt-metrics">
                <div className="gt-metric"><div className="value" style={{ color: "var(--accent-green)" }}>{(gtMetrics.iou * 100).toFixed(1)}%</div><div className="label">IoU</div></div>
                <div className="gt-metric"><div className="value" style={{ color: "var(--accent-cyan)" }}>{(gtMetrics.dice * 100).toFixed(1)}%</div><div className="label">Dice Score</div></div>
                <div className="gt-metric"><div className="value" style={{ color: "var(--accent-secondary)" }}>{(gtMetrics.accuracy * 100).toFixed(1)}%</div><div className="label">Accuracy</div></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== HISTORY GALLERY ===== */}
      {history.length > 0 && (
        <div className="history-section">
          <h3>🕘 Session History</h3>
          <div className="history-grid">
            {history.map((entry) => (
              <div key={entry.id} className="history-item" onClick={() => { setResult(entry.result); setActiveTab("overlay"); }}>
                <img src={`data:image/png;base64,${entry.overlay}`} alt={entry.filename} />
                <div className="history-label">{entry.filename}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
