"use client";

import { useSession } from "@/lib/auth-client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface SavedResult {
  id: number;
  filename: string;
  road_percentage: number;
  avg_confidence: number;
  inference_time_ms: number;
  overlay_b64: string;
  created_at: string;
}

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [results, setResults] = useState<SavedResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);

  useEffect(() => {
    if (!isPending && !session) router.push("/sign-in");
  }, [isPending, session, router]);

  useEffect(() => {
    if (session) {
      fetch("/api/segmentation/history")
        .then((r) => r.json())
        .then((data) => { setResults(data.results || []); setLoadingResults(false); })
        .catch(() => setLoadingResults(false));
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

  const totalResults = results.length;
  const avgRoad = totalResults ? (results.reduce((s, r) => s + r.road_percentage, 0) / totalResults).toFixed(1) : "—";
  const avgConf = totalResults ? (results.reduce((s, r) => s + r.avg_confidence, 0) / totalResults).toFixed(1) : "—";
  const avgTime = totalResults ? (results.reduce((s, r) => s + r.inference_time_ms, 0) / totalResults).toFixed(0) : "—";

  return (
    <div className="segment-page">
      {/* Welcome banner */}
      <div className="dash-welcome">
        <div className="dash-welcome-bg" />
        <div className="dash-welcome-content">
          <div className="dash-avatar">
            {(session.user.name || "U")[0].toUpperCase()}
          </div>
          <div>
            <h1>
              Welcome back, <span className="gradient-text">{session.user.name || "User"}</span>
            </h1>
            <p className="dash-welcome-sub">
              {session.user.email} · {totalResults} segmentation{totalResults !== 1 ? "s" : ""} saved
            </p>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="dash-stats-row">
        <div className="dash-stat-card">
          <div className="dash-stat-icon">🧪</div>
          <div className="dash-stat-value">{totalResults}</div>
          <div className="dash-stat-label">Total Runs</div>
        </div>
        <div className="dash-stat-card">
          <div className="dash-stat-icon">🛣️</div>
          <div className="dash-stat-value">{avgRoad}%</div>
          <div className="dash-stat-label">Avg Road</div>
        </div>
        <div className="dash-stat-card">
          <div className="dash-stat-icon">🎯</div>
          <div className="dash-stat-value">{avgConf}%</div>
          <div className="dash-stat-label">Avg Confidence</div>
        </div>
        <div className="dash-stat-card">
          <div className="dash-stat-icon">⚡</div>
          <div className="dash-stat-value">{avgTime}ms</div>
          <div className="dash-stat-label">Avg Speed</div>
        </div>
      </div>

      {/* Quick actions */}
      <h2 className="dash-section-title">⚡ Quick Actions</h2>
      <div className="dash-actions-grid">
        <Link href="/segment" className="dash-action-card dash-action-primary">
          <div className="dash-action-icon">🔍</div>
          <h3>Segment</h3>
          <p>Upload a road image and run AI segmentation</p>
          <span className="dash-action-arrow">→</span>
        </Link>
        <Link href="/video" className="dash-action-card dash-action-primary">
          <div className="dash-action-icon">🎬</div>
          <h3>Video</h3>
          <p>Process road videos frame-by-frame</p>
          <span className="dash-action-arrow">→</span>
        </Link>
        <Link href="/compare" className="dash-action-card">
          <div className="dash-action-icon">⚖️</div>
          <h3>Compare</h3>
          <p>UNet vs classical methods side by side</p>
          <span className="dash-action-arrow">→</span>
        </Link>
        <Link href="/batch" className="dash-action-card">
          <div className="dash-action-icon">📂</div>
          <h3>Batch</h3>
          <p>Process multiple images with CSV report</p>
          <span className="dash-action-arrow">→</span>
        </Link>
      </div>

      {/* Recent results */}
      <h2 className="dash-section-title" style={{ marginTop: 48 }}>🕘 Recent Results</h2>
      {loadingResults ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : results.length === 0 ? (
        <div className="dash-empty-state">
          <div className="dash-empty-icon">📭</div>
          <h3>No results yet</h3>
          <p>Run a segmentation to see your results here</p>
          <Link href="/segment" className="auth-primary-btn" style={{ width: "auto", padding: "12px 32px", display: "inline-block", textDecoration: "none", textAlign: "center" }}>
            Start Segmenting →
          </Link>
        </div>
      ) : (
        <div className="dash-recent-grid">
          {results.slice(0, 6).map((r) => (
            <Link href="/results" key={r.id} className="dash-recent-card">
              <div className="dash-recent-thumb">
                <img src={`data:image/png;base64,${r.overlay_b64}`} alt={r.filename} />
              </div>
              <div className="dash-recent-info">
                <span className="dash-recent-name">{r.filename}</span>
                <span className="dash-recent-meta">
                  {r.road_percentage}% · {new Date(r.created_at).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
