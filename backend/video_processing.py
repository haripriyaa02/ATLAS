"""
ATLAS — Video Processing Module
Frame-by-frame road segmentation for video inputs.
"""

import cv2
import numpy as np
import subprocess
import shutil
import os
import time
import gc
from typing import Tuple


class VideoProcessor:
    """Process video files frame-by-frame using the road segmentation model."""

    def __init__(self, inference_model):
        self.model = inference_model
        self._ffmpeg = shutil.which("ffmpeg")
        if self._ffmpeg:
            print("✅ ffmpeg found — browser-compatible H.264 output enabled")
        else:
            print("⚠️  ffmpeg not found — video playback in browser may not work")

    def _reencode_h264(self, src: str, dst: str) -> bool:
        """Re-encode a video to H.264/AAC MP4 using ffmpeg for browser compatibility."""
        if not self._ffmpeg:
            return False
        try:
            subprocess.run(
                [
                    self._ffmpeg,
                    "-y",
                    "-i", src,
                    "-c:v", "libx264",
                    "-preset", "fast",
                    "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart",
                    "-an",
                    dst,
                ],
                check=True,
                capture_output=True,
                timeout=600,
            )
            return True
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as e:
            print(f"⚠️  ffmpeg re-encode failed: {e}")
            return False

    def process_video(
        self,
        input_path: str,
        output_path: str,
        threshold: float = 0.5,
        max_frames: int = 0,
        sample_rate: int = 1,
        overlay_alpha: float = 0.45,
    ) -> dict:
        """
        Process a video file and produce an output video with road segmentation overlay.

        Args:
            input_path: Path to input video file.
            output_path: Path to write the output video.
            threshold: Segmentation threshold (0-1).
            max_frames: Max frames to process (0 = all frames).
            sample_rate: Process every Nth frame (1 = every frame).
            overlay_alpha: Overlay transparency.

        Returns:
            Dictionary with processing statistics.
        """
        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise ValueError("Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        orig_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        orig_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Downscale to max 480p to save memory on free-tier servers
        MAX_HEIGHT = 480
        if orig_height > MAX_HEIGHT:
            scale = MAX_HEIGHT / orig_height
            width = int(orig_width * scale)
            height = MAX_HEIGHT
        else:
            width = orig_width
            height = orig_height

        # Write with mp4v first (OpenCV reliable), then re-encode to H.264
        raw_path = output_path + ".raw.mp4"
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(raw_path, fourcc, fps / sample_rate, (width, height))

        if not out.isOpened():
            cap.release()
            raise ValueError("Could not create output video writer")

        frame_idx = 0
        processed_count = 0
        total_inference_ms = 0.0
        road_percentages = []

        start_time = time.perf_counter()

        while True:
            ret, frame_bgr = cap.read()
            if not ret:
                break

            frame_idx += 1

            # Skip frames based on sample rate
            if (frame_idx - 1) % sample_rate != 0:
                continue

            # Check max_frames limit
            if max_frames > 0 and processed_count >= max_frames:
                break

            # Downscale frame if needed
            if frame_bgr.shape[0] != height or frame_bgr.shape[1] != width:
                frame_bgr = cv2.resize(frame_bgr, (width, height))

            # Convert BGR to RGB for model
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

            # Run inference
            mask, prob_map, inference_ms = self.model.predict(frame_rgb, threshold=threshold)
            overlay_rgb = self.model.create_overlay(frame_rgb, mask, alpha=overlay_alpha)

            # Convert back to BGR for video writing
            overlay_bgr = cv2.cvtColor(overlay_rgb, cv2.COLOR_RGB2BGR)
            out.write(overlay_bgr)

            total_inference_ms += inference_ms
            total_px = mask.shape[0] * mask.shape[1]
            road_px = int(np.sum(mask > 0))
            road_percentages.append(round(road_px / total_px * 100, 2))
            processed_count += 1
            
            # Prevent Out of Memory (OOM) on free-tier servers (Render 512MB)
            del frame_bgr
            del frame_rgb
            del mask
            del prob_map
            del overlay_rgb
            del overlay_bgr
            if processed_count % 10 == 0:
                gc.collect()

        total_time = (time.perf_counter() - start_time) * 1000

        cap.release()
        out.release()
        gc.collect()

        # Re-encode to H.264 for browser playback
        if self._reencode_h264(raw_path, output_path):
            # Clean up raw file
            if os.path.exists(raw_path):
                os.unlink(raw_path)
        else:
            # Fallback: just rename raw to output
            if os.path.exists(raw_path):
                os.replace(raw_path, output_path)

        avg_road = round(sum(road_percentages) / len(road_percentages), 2) if road_percentages else 0.0
        avg_inference = round(total_inference_ms / processed_count, 1) if processed_count > 0 else 0.0

        return {
            "total_frames": total_frames,
            "processed_frames": processed_count,
            "fps": round(fps, 2),
            "sample_rate": sample_rate,
            "output_fps": round(fps / sample_rate, 2),
            "resolution": [width, height],
            "avg_inference_ms": avg_inference,
            "total_processing_ms": round(total_time, 1),
            "avg_road_percentage": avg_road,
            "threshold": threshold,
        }

    def extract_preview_frame(
        self, video_path: str, frame_number: int = 0
    ) -> Tuple[np.ndarray, dict]:
        """
        Extract a single frame from the video for preview and return video info.

        Returns:
            Tuple of (RGB frame array, video info dict)
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError("Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0

        # Seek to requested frame
        if frame_number > 0:
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(frame_number, total_frames - 1))

        ret, frame_bgr = cap.read()
        cap.release()

        if not ret:
            raise ValueError("Could not read frame from video")

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

        info = {
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "duration_seconds": round(duration, 2),
        }

        return frame_rgb, info
