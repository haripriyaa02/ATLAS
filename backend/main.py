"""
ATLAS — FastAPI Backend
Road Segmentation API powered by UNet deep learning model + classical methods.
"""

import io
import base64
import os
import time
import zipfile
import gc

import cv2
import numpy as np
from PIL import Image
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from inference import RoadSegmentationInference
from classical_methods import run_all_methods, compute_metrics, preprocess_for_classical
from video_processing import VideoProcessor

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ATLAS API",
    description="Adaptive Thresholding with Language-Augmented Sensing — Road Segmentation",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Load model at startup
# ---------------------------------------------------------------------------
MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "model.pt")
CONFIG_PATH = os.path.join(MODEL_DIR, "model_config.json")

model: RoadSegmentationInference | None = None
video_processor: VideoProcessor | None = None


@app.on_event("startup")
async def load_model():
    global model, video_processor
    if not os.path.exists(MODEL_PATH):
        print(f"⚠️  Model file not found at {MODEL_PATH}")
        return
    model = RoadSegmentationInference(MODEL_PATH, CONFIG_PATH, device="cuda")
    video_processor = VideoProcessor(model)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def numpy_to_base64_png(img: np.ndarray) -> str:
    """Convert a numpy image (RGB or grayscale) to a base64-encoded PNG string."""
    if len(img.shape) == 2:
        pil_img = Image.fromarray(img, mode="L")
    else:
        pil_img = Image.fromarray(img, mode="RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def numpy_to_base64_jpeg(img: np.ndarray, quality: int = 80, max_dim: int = 800) -> str:
    """Convert a numpy image to a compressed base64-encoded JPEG string."""
    h, w = img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))

    if len(img.shape) == 2:
        pil_img = Image.fromarray(img, mode="L")
    else:
        pil_img = Image.fromarray(img, mode="RGB")
    buf = io.BytesIO()
    pil_img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def read_upload_image(contents: bytes) -> np.ndarray:
    """Decode uploaded bytes to RGB numpy array."""
    nparr = np.frombuffer(contents, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        raise HTTPException(400, "Invalid image file")
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)


def make_heatmap(prob_map: np.ndarray) -> np.ndarray:
    """Convert probability map (0-1 float) to a color heatmap (RGB)."""
    prob_u8 = (prob_map * 255).astype(np.uint8)
    heatmap_bgr = cv2.applyColorMap(prob_u8, cv2.COLORMAP_JET)
    return cv2.cvtColor(heatmap_bgr, cv2.COLOR_BGR2RGB)


# ---------------------------------------------------------------------------
# 1. Core endpoints
# ---------------------------------------------------------------------------
@app.get("/")
async def health():
    return {
        "status": "ok",
        "service": "ATLAS Road Segmentation API v2",
        "model_loaded": model is not None,
    }


@app.get("/model/info")
async def model_info():
    if model is None:
        raise HTTPException(503, "Model not loaded")
    return {
        "config": model.config,
        "device": str(model.device),
        "input_size": list(model.img_size),
    }


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
):
    """Upload image → UNet mask + overlay + heatmap + metrics."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    contents = await file.read()
    img_rgb = read_upload_image(contents)

    mask, prob_map, inference_ms = model.predict(img_rgb, threshold=threshold)
    overlay = model.create_overlay(img_rgb, mask)
    heatmap = make_heatmap(prob_map)

    total_pixels = mask.shape[0] * mask.shape[1]
    road_pixels = int(np.sum(mask > 0))
    road_pct = round(road_pixels / total_pixels * 100, 2)
    avg_conf = round(float(np.mean(prob_map[mask > 0])) * 100, 2) if road_pixels > 0 else 0.0

    return JSONResponse({
        "original": numpy_to_base64_png(img_rgb),
        "mask": numpy_to_base64_png(mask),
        "overlay": numpy_to_base64_png(overlay),
        "heatmap": numpy_to_base64_png(heatmap),
        "metrics": {
            "inference_time_ms": round(inference_ms, 1),
            "road_percentage": road_pct,
            "road_pixels": road_pixels,
            "total_pixels": total_pixels,
            "avg_confidence": avg_conf,
            "threshold": threshold,
            "image_size": [img_rgb.shape[1], img_rgb.shape[0]],
        },
    })


# ---------------------------------------------------------------------------
# 2. Compare Mode — all methods on one image
# ---------------------------------------------------------------------------
@app.post("/compare")
async def compare(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
):
    """Run UNet + all 5 classical methods on the same image and return results."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    contents = await file.read()
    img_rgb = read_upload_image(contents)

    # UNet
    mask, prob_map, inference_ms = model.predict(img_rgb, threshold=threshold)
    overlay = model.create_overlay(img_rgb, mask)
    total_px = mask.shape[0] * mask.shape[1]
    road_px = int(np.sum(mask > 0))

    unet_result = {
        "key": "unet",
        "label": "UNet (ResNet34) ⭐",
        "description": "Deep learning model — best overall accuracy.",
        "mask": numpy_to_base64_png(mask),
        "overlay": numpy_to_base64_png(overlay),
        "time_ms": round(inference_ms, 1),
        "road_percentage": round(road_px / total_px * 100, 2),
    }

    # Classical methods
    classical = run_all_methods(img_rgb)
    method_results = [unet_result]

    for key, info in classical.items():
        cmask = info["mask"]
        c_overlay = model.create_overlay(img_rgb, cmask)
        c_road = int(np.sum(cmask > 0))
        method_results.append({
            "key": key,
            "label": info["label"],
            "description": info["description"],
            "mask": numpy_to_base64_png(cmask),
            "overlay": numpy_to_base64_png(c_overlay),
            "time_ms": info["time_ms"],
            "road_percentage": round(c_road / total_px * 100, 2),
        })

    return JSONResponse({
        "original": numpy_to_base64_png(img_rgb),
        "methods": method_results,
    })


# ---------------------------------------------------------------------------
# 3. Pipeline Visualizer — intermediate steps
# ---------------------------------------------------------------------------
@app.post("/pipeline")
async def pipeline(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
):
    """Return all intermediate pipeline steps for visualization."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    contents = await file.read()
    img_rgb = read_upload_image(contents)

    # Step 1: Original
    original_b64 = numpy_to_base64_png(img_rgb)

    # Step 2: Resized
    resized = cv2.resize(img_rgb, model.img_size)
    resized_b64 = numpy_to_base64_png(resized)

    # Step 3: Normalized (visualize as shifted image)
    norm = resized.astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406])
    std = np.array([0.229, 0.224, 0.225])
    normalized = (norm - mean) / std
    # Scale back to visible range for display
    norm_vis = ((normalized - normalized.min()) / (normalized.max() - normalized.min()) * 255).astype(np.uint8)
    normalized_b64 = numpy_to_base64_png(norm_vis)

    # Step 4: Run inference
    mask, prob_map, inference_ms = model.predict(img_rgb, threshold=threshold)

    # Step 5: Probability map (raw sigmoid output as heatmap)
    heatmap = make_heatmap(prob_map)
    heatmap_b64 = numpy_to_base64_png(heatmap)

    # Step 6: Binary mask
    mask_b64 = numpy_to_base64_png(mask)

    # Step 7: Overlay
    overlay = model.create_overlay(img_rgb, mask)
    overlay_b64 = numpy_to_base64_png(overlay)

    steps = [
        {"name": "Original Input", "image": original_b64, "description": "Raw uploaded image"},
        {"name": "Resized (256×256)", "image": resized_b64, "description": "Resized to model input dimensions"},
        {"name": "Normalized", "image": normalized_b64, "description": "ImageNet mean/std normalization applied"},
        {"name": "Confidence Heatmap", "image": heatmap_b64, "description": "Raw model output after sigmoid — red = high confidence road"},
        {"name": "Binary Mask", "image": mask_b64, "description": f"Thresholded at {threshold} — white = road"},
        {"name": "Final Overlay", "image": overlay_b64, "description": "Road mask blended onto original with edge glow"},
    ]

    return JSONResponse({
        "steps": steps,
        "inference_time_ms": round(inference_ms, 1),
    })


# ---------------------------------------------------------------------------
# 4. Threshold Grid — multiple thresholds at once
# ---------------------------------------------------------------------------
@app.post("/threshold-grid")
async def threshold_grid(
    file: UploadFile = File(...),
):
    """Run prediction at multiple thresholds and return all results."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    contents = await file.read()
    img_rgb = read_upload_image(contents)

    thresholds = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    results = []

    # Get probability map once
    _, prob_map, _ = model.predict(img_rgb, threshold=0.5)

    for t in thresholds:
        binary = (prob_map > t).astype(np.uint8) * 255
        overlay = model.create_overlay(img_rgb, binary)
        road_pct = round(np.sum(binary > 0) / binary.size * 100, 2)
        results.append({
            "threshold": t,
            "mask": numpy_to_base64_png(binary),
            "overlay": numpy_to_base64_png(overlay),
            "road_percentage": road_pct,
        })

    return JSONResponse({"original": numpy_to_base64_png(img_rgb), "results": results})


# ---------------------------------------------------------------------------
# 5. Compute Metrics — compare predicted mask vs user-drawn ground truth
# ---------------------------------------------------------------------------
@app.post("/compute-metrics")
async def compute_metrics_endpoint(
    predicted: UploadFile = File(...),
    ground_truth: UploadFile = File(...),
):
    """Compute IoU & Dice between two masks."""
    pred_bytes = await predicted.read()
    gt_bytes = await ground_truth.read()

    pred_arr = cv2.imdecode(np.frombuffer(pred_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
    gt_arr = cv2.imdecode(np.frombuffer(gt_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)

    if pred_arr is None or gt_arr is None:
        raise HTTPException(400, "Invalid mask images")

    # Resize GT to match prediction if needed
    if pred_arr.shape != gt_arr.shape:
        gt_arr = cv2.resize(gt_arr, (pred_arr.shape[1], pred_arr.shape[0]), interpolation=cv2.INTER_NEAREST)

    metrics = compute_metrics(pred_arr, gt_arr)
    return JSONResponse(metrics)


# ---------------------------------------------------------------------------
# 6. Batch Predict
# ---------------------------------------------------------------------------
@app.post("/predict/batch")
async def predict_batch(
    files: list[UploadFile] = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
):
    """Predict on multiple images at once."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    results = []
    for f in files:
        contents = await f.read()
        img_rgb = read_upload_image(contents)
        mask, prob_map, inference_ms = model.predict(img_rgb, threshold=threshold)
        overlay = model.create_overlay(img_rgb, mask)

        total_px = mask.shape[0] * mask.shape[1]
        road_px = int(np.sum(mask > 0))
        road_pct = round(road_px / total_px * 100, 2)
        avg_conf = round(float(np.mean(prob_map[mask > 0])) * 100, 2) if road_px > 0 else 0.0

        results.append({
            "filename": f.filename,
            "original": numpy_to_base64_png(img_rgb),
            "mask": numpy_to_base64_png(mask),
            "overlay": numpy_to_base64_png(overlay),
            "metrics": {
                "inference_time_ms": round(inference_ms, 1),
                "road_percentage": road_pct,
                "avg_confidence": avg_conf,
                "image_size": [img_rgb.shape[1], img_rgb.shape[0]],
            },
        })

    return JSONResponse({"count": len(results), "results": results})


# ---------------------------------------------------------------------------
# 7. Download ZIP — mask + overlay + metrics for a single prediction
# ---------------------------------------------------------------------------
@app.post("/download")
async def download_zip(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
):
    """Run prediction and return a ZIP with mask, overlay, heatmap, and metrics JSON."""
    if model is None:
        raise HTTPException(503, "Model not loaded")

    contents = await file.read()
    img_rgb = read_upload_image(contents)
    mask, prob_map, inference_ms = model.predict(img_rgb, threshold=threshold)
    overlay = model.create_overlay(img_rgb, mask)
    heatmap = make_heatmap(prob_map)

    total_px = mask.shape[0] * mask.shape[1]
    road_px = int(np.sum(mask > 0))

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Original
        orig_buf = io.BytesIO()
        Image.fromarray(img_rgb).save(orig_buf, format="PNG")
        zf.writestr("original.png", orig_buf.getvalue())

        # Mask
        mask_buf = io.BytesIO()
        Image.fromarray(mask, mode="L").save(mask_buf, format="PNG")
        zf.writestr("mask.png", mask_buf.getvalue())

        # Overlay
        ov_buf = io.BytesIO()
        Image.fromarray(overlay).save(ov_buf, format="PNG")
        zf.writestr("overlay.png", ov_buf.getvalue())

        # Heatmap
        hm_buf = io.BytesIO()
        Image.fromarray(heatmap).save(hm_buf, format="PNG")
        zf.writestr("heatmap.png", hm_buf.getvalue())

        # Metrics
        import json
        metrics = {
            "inference_time_ms": round(inference_ms, 1),
            "road_percentage": round(road_px / total_px * 100, 2),
            "threshold": threshold,
            "image_size": [img_rgb.shape[1], img_rgb.shape[0]],
        }
        zf.writestr("metrics.json", json.dumps(metrics, indent=2))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=atlas_results.zip"},
    )


# ---------------------------------------------------------------------------
# 8. Video Info — get metadata and preview frame from a video
# ---------------------------------------------------------------------------
import tempfile

@app.post("/video/info")
async def video_info(file: UploadFile = File(...)):
    """Get video metadata and a preview frame."""
    if model is None or video_processor is None:
        raise HTTPException(503, "Model not loaded")

    # Save uploaded video to temp file
    suffix = os.path.splitext(file.filename or "video.mp4")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        frame_rgb, info = video_processor.extract_preview_frame(tmp_path)
        preview_b64 = numpy_to_base64_jpeg(frame_rgb)

        # Also run prediction on preview frame
        mask, prob_map, inference_ms = model.predict(frame_rgb, threshold=0.5)
        overlay = model.create_overlay(frame_rgb, mask)
        overlay_b64 = numpy_to_base64_jpeg(overlay)

        total_px = mask.shape[0] * mask.shape[1]
        road_px = int(np.sum(mask > 0))

        return JSONResponse({
            "info": info,
            "preview": preview_b64,
            "preview_overlay": overlay_b64,
            "preview_metrics": {
                "road_percentage": round(road_px / total_px * 100, 2),
                "inference_time_ms": round(inference_ms, 1),
            },
        })
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# 9. Video Predict — process full video with road segmentation overlay
# ---------------------------------------------------------------------------
@app.post("/predict/video")
async def predict_video(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
    sample_rate: int = Query(1, ge=1, le=30),
    max_frames: int = Query(0, ge=0),
):
    """Upload a video → process frame-by-frame → return processed MP4 + stats."""
    if model is None or video_processor is None:
        raise HTTPException(503, "Model not loaded")

    suffix = os.path.splitext(file.filename or "video.mp4")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        contents = await file.read()
        tmp_in.write(contents)
        input_path = tmp_in.name

    # Free upload bytes immediately
    del contents
    gc.collect()

    output_path = input_path + "_output.mp4"

    try:
        stats = video_processor.process_video(
            input_path=input_path,
            output_path=output_path,
            threshold=threshold,
            max_frames=max_frames,
            sample_rate=sample_rate,
        )

        # Delete input video BEFORE reading output to free memory
        if os.path.exists(input_path):
            os.unlink(input_path)
        gc.collect()

        # Read the output video and encode as base64
        with open(output_path, "rb") as f:
            video_bytes = f.read()

        video_b64 = base64.b64encode(video_bytes).decode("utf-8")
        del video_bytes
        gc.collect()

        return JSONResponse({
            "video": video_b64,
            "stats": stats,
        })
    finally:
        for p in [input_path, output_path, output_path + ".raw.mp4"]:
            if os.path.exists(p):
                os.unlink(p)


# ---------------------------------------------------------------------------
# 10. Video Download — process and stream back as MP4
# ---------------------------------------------------------------------------
@app.post("/predict/video/download")
async def predict_video_download(
    file: UploadFile = File(...),
    threshold: float = Query(0.5, ge=0.0, le=1.0),
    sample_rate: int = Query(1, ge=1, le=30),
    max_frames: int = Query(0, ge=0),
):
    """Upload a video → process → stream back the result MP4 as download."""
    if model is None or video_processor is None:
        raise HTTPException(503, "Model not loaded")

    suffix = os.path.splitext(file.filename or "video.mp4")[1]
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_in:
        contents = await file.read()
        tmp_in.write(contents)
        input_path = tmp_in.name

    output_path = input_path + "_output.mp4"

    try:
        video_processor.process_video(
            input_path=input_path,
            output_path=output_path,
            threshold=threshold,
            max_frames=max_frames,
            sample_rate=sample_rate,
        )

        with open(output_path, "rb") as f:
            video_bytes = f.read()

        buf = io.BytesIO(video_bytes)
        return StreamingResponse(
            buf,
            media_type="video/mp4",
            headers={"Content-Disposition": "attachment; filename=atlas_segmented.mp4"},
        )
    finally:
        for p in [input_path, output_path, output_path + ".raw.mp4"]:
            if os.path.exists(p):
                os.unlink(p)
