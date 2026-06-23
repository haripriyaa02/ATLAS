import Link from "next/link";

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="hero-bg" />
        <div className="hero-grid" />
        <div className="hero-content">
          <div className="hero-badge">
            <span className="dot" />
            AI-Powered Road Segmentation
          </div>
          <h1>
            Map Every Road
            <br />
            with <span className="gradient-text">Intelligence</span>
          </h1>
          <p>
            ATLAS combines a deep-learning UNet model with adaptive thresholding
            to deliver fast, accurate road segmentation on images and videos — no
            manual tuning required.
          </p>
          <div className="hero-actions">
            <Link href="/segment" className="btn btn-primary">
              🚀 Try Segmentation
            </Link>
            <Link href="/about" className="btn btn-secondary">
              Learn More →
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="stats-bar">
        <div className="stat-item">
          <div className="stat-value">85%+</div>
          <div className="stat-label">Validation IoU</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">~15ms</div>
          <div className="stat-label">Inference Time</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">UNet</div>
          <div className="stat-label">Architecture</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">Zero</div>
          <div className="stat-label">Manual Tuning</div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="section-label">Capabilities</div>
        <h2 className="section-title">What ATLAS Can Do</h2>
        <p className="section-subtitle">
          From satellite imagery to dashcam footage — upload any road image or
          video and get instant, pixel-level segmentation.
        </p>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🧠</div>
            <h3>Deep Learning Backbone</h3>
            <p>
              UNet with ResNet34 encoder trained on thousands of annotated road
              images. Achieves 85%+ IoU on validation data.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">⚡</div>
            <h3>Real-Time Inference</h3>
            <p>
              TorchScript-optimized model runs in ~15ms per image on GPU,
              enabling real-time applications, batch processing, and full video
              segmentation.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎨</div>
            <h3>Visual Overlays</h3>
            <p>
              Get the binary mask, probability map, and a beautiful color
              overlay showing detected road regions with edge highlighting.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Detailed Metrics</h3>
            <p>
              Every prediction returns inference time, road coverage percentage,
              and model confidence — all in one API call.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🔧</div>
            <h3>Adjustable Threshold</h3>
            <p>
              Fine-tune the prediction threshold to balance between precision
              and recall for your specific use case.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">🎬</div>
            <h3>Image & Video Analysis</h3>
            <p>
              Upload road images or dashcam footage and get instant
              segmentation with downloadable processed output.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
