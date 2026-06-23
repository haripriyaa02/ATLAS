"use client";

import { useState, useRef, useCallback } from "react";

const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

interface VideoInfo {
  fps: number;
  width: number;
  height: number;
  total_frames: number;
  duration_seconds: number;
}

interface VideoStats {
  total_frames: number;
  processed_frames: number;
  fps: number;
  sample_rate: number;
  output_fps: number;
  resolution: [number, number];
  avg_inference_ms: number;
  total_processing_ms: number;
  avg_road_percentage: number;
  threshold: number;
}

interface VideoResult {
  video: string;
  stats: VideoStats;
}

export default function VideoPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [previewOverlay, setPreviewOverlay] = useState<string | null>(null);

  const [threshold, setThreshold] = useState(0.5);
  const [sampleRate, setSampleRate] = useState(3);
  const [maxFrames, setMaxFrames] = useState(30);

  const [result, setResult] = useState<VideoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [infoLoading, setInfoLoading] = useState(false);
  const [updatingPreview, setUpdatingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [previewTab, setPreviewTab] = useState<"original" | "overlay">("original");

  const handleFile = useCallback(async (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setResult(null);
    setError(null);
    setVideoInfo(null);
    setPreviewFrame(null);
    setPreviewOverlay(null);

    // Get video info
    setInfoLoading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch(`${API}/video/info`, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setVideoInfo(data.info);
      setPreviewFrame(data.preview);
      setPreviewOverlay(data.preview_overlay);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load video info");
    } finally {
      setInfoLoading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f && f.type.startsWith("video/")) handleFile(f);
    },
    [handleFile]
  );

  const updatePreview = async () => {
    if (!previewFrame) return;
    setUpdatingPreview(true);
    try {
      const res = await fetch(`data:image/jpeg;base64,${previewFrame}`);
      const blob = await res.blob();
      const form = new FormData();
      form.append("file", blob, "preview.jpg");
      
      const predictRes = await fetch(`${API}/predict?threshold=${threshold}`, {
        method: "POST",
        body: form,
      });
      if (!predictRes.ok) throw new Error(await predictRes.text());
      const data = await predictRes.json();
      setPreviewOverlay(data.overlay);
      setPreviewTab("overlay");
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingPreview(false);
    }
  };

  const runVideoSegmentation = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setProgress("Uploading video...");
    try {
      const form = new FormData();
      form.append("file", file);
      const url = `${API}/predict/video?threshold=${threshold}&sample_rate=${sampleRate}&max_frames=${maxFrames}`;
      setProgress("Processing frames — this may take a while...");
      const res = await fetch(url, { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      setProgress("Decoding result...");
      const data: VideoResult = await res.json();
      setResult(data);
      setProgress("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Video processing failed");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const downloadResult = async () => {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const url = `${API}/predict/video/download?threshold=${threshold}&sample_rate=${sampleRate}&max_frames=${maxFrames}`;
    const res = await fetch(url, { method: "POST", body: form });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "atlas_segmented.mp4";
    a.click();
  };

  const clearAll = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setVideoInfo(null);
    setPreviewFrame(null);
    setPreviewOverlay(null);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="segment-page">
      <div className="page-header">
        <h1>
          🎬 Video <span className="gradient-text">Segmentation</span>
        </h1>
        <p>Upload a road video and ATLAS will segment every frame in real time.</p>
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
          <div className="upload-icon">🎬</div>
          <h3>Drop your road video here</h3>
          <p>or <span className="browse-link">browse files</span> · MP4, AVI, MOV, MKV supported</p>
          <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        </div>
      )}

      {/* Preview + controls */}
      {preview && (
        <>
          <div className="preview-bar">
            <div className="video-preview-thumb">
              <video src={preview} muted className="preview-thumb" style={{ objectFit: "cover" }} />
            </div>
            <div className="preview-info">
              <div className="filename">{file?.name}</div>
              <div className="filesize">
                {file ? (file.size / (1024 * 1024)).toFixed(1) + " MB" : ""}
                {videoInfo && ` · ${formatDuration(videoInfo.duration_seconds)} · ${videoInfo.width}×${videoInfo.height} · ${videoInfo.fps} fps · ${videoInfo.total_frames} frames`}
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: "8px 16px", fontSize: "0.8rem" }} onClick={clearAll}>✕ Clear</button>
          </div>

          {/* Video info loading */}
          {infoLoading && (
            <div className="loading-container" style={{ padding: "40px 20px" }}>
              <div className="spinner" />
              <div className="loading-text">Analyzing video...</div>
            </div>
          )}

          {/* Preview frame comparison */}
          {previewFrame && !result && (
            <div className="video-preview-section">
              <div className="results-tabs" style={{ marginTop: 24, marginBottom: 16 }}>
                <button className={`results-tab ${previewTab === "original" ? "active" : ""}`} onClick={() => setPreviewTab("original")}>📷 First Frame</button>
                <button className={`results-tab ${previewTab === "overlay" ? "active" : ""}`} onClick={() => setPreviewTab("overlay")}>🎨 Preview Overlay</button>
              </div>
              <div className="result-image-container">
                <img src={`data:image/jpeg;base64,${previewTab === "original" ? previewFrame : previewOverlay}`} alt="Preview" />
              </div>
            </div>
          )}

          {/* Controls */}
          {videoInfo && !loading && !result && (
            <div className="video-controls">
              <div className="controls-row">
                <div className="control-group">
                  <label>Threshold <span className="threshold-value">{threshold.toFixed(2)}</span></label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="range" min="0.1" max="0.9" step="0.05" value={threshold} className="threshold-slider" onChange={(e) => setThreshold(parseFloat(e.target.value))} style={{ flex: 1 }} />
                    <button className="btn btn-secondary" onClick={updatePreview} disabled={updatingPreview} style={{ padding: "6px 12px", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                      {updatingPreview ? "⏳" : "🔄 Update Preview"}
                    </button>
                  </div>
                </div>
                <div className="control-group">
                  <label>Sample Rate <span className="threshold-value">every {sampleRate}{sampleRate === 1 ? "st" : sampleRate === 2 ? "nd" : sampleRate === 3 ? "rd" : "th"} frame</span></label>
                  <input type="range" min="1" max="10" step="1" value={sampleRate} className="threshold-slider" onChange={(e) => setSampleRate(parseInt(e.target.value))} />
                </div>
              </div>
              <div className="controls-row" style={{ marginTop: 12 }}>
                <div className="control-group">
                  <label>Max Frames <span className="threshold-value">{maxFrames === 0 ? "All" : maxFrames}</span></label>
                  <input type="range" min="0" max="500" step="10" value={maxFrames} className="threshold-slider" onChange={(e) => setMaxFrames(parseInt(e.target.value))} />
                </div>
                <button className="btn btn-primary" onClick={runVideoSegmentation} disabled={loading} style={{ height: 46 }}>
                  🚀 Process Video
                </button>
              </div>
              {videoInfo && sampleRate > 1 && (
                <div className="video-estimate">
                  <span>📊 Estimated: {Math.ceil(videoInfo.total_frames / sampleRate)} frames to process at {(videoInfo.fps / sampleRate).toFixed(1)} fps output</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {error && <div className="error-banner">⚠️ {error}</div>}

      {loading && (
        <div className="loading-container">
          <div className="spinner" />
          <div className="loading-text">{progress || "Processing video..."}</div>
          <div className="video-progress-hint">This may take several minutes for longer videos. Consider increasing the sample rate or limiting max frames.</div>
        </div>
      )}

      {/* ===== RESULTS ===== */}
      {result && !loading && (
        <div className="results-section">
          <h2 style={{ marginBottom: 24 }}>✅ Processed Video</h2>

          {/* Video player */}
          <div className="video-player-container">
            <video
              controls
              autoPlay
              loop
              className="video-player"
              src={`data:video/mp4;base64,${result.video}`}
            />
          </div>

          {/* Stats */}
          <div className="metrics-grid" style={{ marginTop: 24 }}>
            <div className="metric-card">
              <div className="metric-value cyan">{result.stats.processed_frames}</div>
              <div className="metric-label">Frames Processed</div>
            </div>
            <div className="metric-card">
              <div className="metric-value green">{result.stats.avg_road_percentage}%</div>
              <div className="metric-label">Avg Road Coverage</div>
            </div>
            <div className="metric-card">
              <div className="metric-value purple">{result.stats.avg_inference_ms}ms</div>
              <div className="metric-label">Avg Inference / Frame</div>
            </div>
            <div className="metric-card">
              <div className="metric-value amber">{formatMs(result.stats.total_processing_ms)}</div>
              <div className="metric-label">Total Processing</div>
            </div>
          </div>

          {/* Extra details */}
          <div className="metrics-grid" style={{ marginTop: 12 }}>
            <div className="metric-card">
              <div className="metric-value cyan">{result.stats.output_fps}</div>
              <div className="metric-label">Output FPS</div>
            </div>
            <div className="metric-card">
              <div className="metric-value green">{result.stats.resolution[0]}×{result.stats.resolution[1]}</div>
              <div className="metric-label">Resolution</div>
            </div>
            <div className="metric-card">
              <div className="metric-value purple">{result.stats.sample_rate}x</div>
              <div className="metric-label">Sample Rate</div>
            </div>
            <div className="metric-card">
              <div className="metric-value amber">{result.stats.threshold}</div>
              <div className="metric-label">Threshold</div>
            </div>
          </div>

          {/* Download */}
          <div className="download-row" style={{ marginTop: 20 }}>
            <button className="btn-download" onClick={() => {
              const a = document.createElement("a");
              a.href = `data:video/mp4;base64,${result.video}`;
              a.download = "atlas_segmented.mp4";
              a.click();
            }}>💾 Download Processed Video</button>
            <button className="btn btn-secondary" style={{ padding: "10px 20px", fontSize: "0.82rem" }} onClick={clearAll}>🔄 New Video</button>
          </div>
        </div>
      )}
    </div>
  );
}
