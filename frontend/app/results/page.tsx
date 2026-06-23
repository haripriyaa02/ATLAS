"use client";

import { useSession } from "@/lib/auth-client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SavedResult {
  id: number;
  filename: string;
  threshold: number;
  road_percentage: number;
  avg_confidence: number;
  inference_time_ms: number;
  image_width: number;
  image_height: number;
  overlay_b64: string;
  mask_b64: string;
  created_at: string;
}

export default function ResultsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [results, setResults] = useState<SavedResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SavedResult | null>(null);
  const [viewMode, setViewMode] = useState<"overlay" | "mask">("overlay");

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in");
    }
  }, [isPending, session, router]);

  useEffect(() => {
    if (session) {
      fetch("/api/segmentation/history")
        .then((r) => r.json())
        .then((data) => {
          setResults(data.results || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [session]);

  if (isPending) {
    return (
      <div className="loading-container" style={{ minHeight: "80vh" }}>
        <div className="spinner" />
        <div className="loading-text">Loading…</div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="segment-page">
      <div className="page-header">
        <h1>
          📁 Past <span className="gradient-text">Results</span>
        </h1>
        <p>All your saved segmentation results, stored securely in the cloud.</p>
      </div>

      {loading ? (
        <div className="loading-container">
          <div className="spinner" />
          <div className="loading-text">Fetching your results…</div>
        </div>
      ) : results.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "4rem", marginBottom: 20 }}>📭</div>
          <h3 style={{ color: "var(--text-primary)", marginBottom: 8 }}>No results yet</h3>
          <p style={{ marginBottom: 24, fontSize: "0.95rem" }}>
            Run a segmentation and your results will be automatically saved here.
          </p>
          <Link href="/segment" className="btn btn-primary">
            🚀 Start Segmenting
          </Link>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="batch-summary" style={{ marginBottom: 32 }}>
            <div className="summary-stat">
              <div className="summary-value">{results.length}</div>
              <div className="summary-label">Total Results</div>
            </div>
            <div className="summary-stat">
              <div className="summary-value">
                {(results.reduce((s, r) => s + r.road_percentage, 0) / results.length).toFixed(1)}%
              </div>
              <div className="summary-label">Avg Road Coverage</div>
            </div>
            <div className="summary-stat">
              <div className="summary-value">
                {(results.reduce((s, r) => s + r.avg_confidence, 0) / results.length).toFixed(1)}%
              </div>
              <div className="summary-label">Avg Confidence</div>
            </div>
            <div className="summary-stat">
              <div className="summary-value">
                {(results.reduce((s, r) => s + r.inference_time_ms, 0) / results.length).toFixed(0)}ms
              </div>
              <div className="summary-label">Avg Inference</div>
            </div>
          </div>

          {/* Selected Detail View */}
          {selected && (
            <div className="results-section" style={{ marginBottom: 48 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontWeight: 700, fontSize: "1.1rem" }}>
                  🔎 {selected.filename}
                </h3>
                <button
                  className="btn btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "0.8rem" }}
                  onClick={() => setSelected(null)}
                >
                  ✕ Close
                </button>
              </div>
              <div className="results-tabs" style={{ marginBottom: 16 }}>
                <button
                  className={`results-tab ${viewMode === "overlay" ? "active" : ""}`}
                  onClick={() => setViewMode("overlay")}
                >
                  🎨 Overlay
                </button>
                <button
                  className={`results-tab ${viewMode === "mask" ? "active" : ""}`}
                  onClick={() => setViewMode("mask")}
                >
                  🖤 Mask
                </button>
              </div>
              <div className="result-image-container">
                <img
                  src={`data:image/png;base64,${viewMode === "overlay" ? selected.overlay_b64 : selected.mask_b64}`}
                  alt={selected.filename}
                />
              </div>
              <div className="metrics-grid" style={{ marginTop: 16 }}>
                <div className="metric-card">
                  <div className="metric-value cyan">{selected.inference_time_ms.toFixed(0)}ms</div>
                  <div className="metric-label">Inference Time</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value green">{selected.road_percentage}%</div>
                  <div className="metric-label">Road Coverage</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value purple">{selected.avg_confidence}%</div>
                  <div className="metric-label">Confidence</div>
                </div>
                <div className="metric-card">
                  <div className="metric-value amber">{selected.image_width}×{selected.image_height}</div>
                  <div className="metric-label">Image Size</div>
                </div>
              </div>
            </div>
          )}

          {/* Results Grid */}
          <div className="history-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {results.map((r) => (
              <div
                key={r.id}
                className="history-item"
                onClick={() => { setSelected(r); setViewMode("overlay"); }}
                style={{ border: selected?.id === r.id ? "1px solid var(--accent-primary)" : undefined }}
              >
                <img src={`data:image/png;base64,${r.overlay_b64}`} alt={r.filename} />
                <div className="history-label">
                  <strong>{r.filename}</strong>
                  <br />
                  {r.road_percentage}% road · {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
