"""
app.py
=======

The glue layer: exposes a FastAPI backend the React dashboard can call.

    POST /process-video            -> upload a video, get back a job_id
                                       IMMEDIATELY (processing happens in
                                       the background, not during this
                                       request)
    GET  /jobs/{job_id}            -> poll this for status + progress +
                                       final clip results
    GET  /clips/{job_id}/{filename} -> download/stream a generated clip
    GET  /health                   -> simple liveness check

Why this version is different from a naive implementation:
    The full pipeline (transcribe -> AI-select -> cut x3) can take
    anywhere from ~30s to several minutes depending on video length and
    hardware. Doing that inside the request/response cycle means the
    HTTP connection has to stay open the whole time -- browsers, proxies,
    and load balancers all tend to time out long-held connections like
    that, and the frontend has no way to show real progress in the
    meantime. So instead:
      1. POST /process-video saves the file, registers a job, schedules
         the real work as a FastAPI BackgroundTask, and returns instantly.
      2. The frontend polls GET /jobs/{job_id} every couple of seconds
         until status is "done" or "failed".

    Note on scale: FastAPI's BackgroundTasks run in this same server
    process (in a thread pool), so this is a solid step up from fully
    synchronous, and is fine for an MVP / low-concurrency deployment.
    It's still bounded by one machine's CPU and by an in-memory job
    store, which is wiped if the server restarts. For real production
    traffic (many simultaneous uploads, multiple server instances), swap
    this for a proper task queue -- Celery or RQ with Redis -- and a
    persistent job store (e.g. a jobs table in Postgres) instead of the
    in-memory dict below. The /jobs/{job_id} contract (status/stage/clips)
    would stay the same either way, so the frontend wouldn't need to change.

This file assumes transcribe.py, find_viral_clips.py, and
create_viral_short.py all live in the same directory (see the integration
guide for the full project layout).

Install:
    pip install fastapi "uvicorn[standard]" python-multipart

Run:
    uvicorn app:app --reload --host 0.0.0.0 --port 8000
"""

import os
import threading
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from create_viral_short import create_viral_short
from find_viral_clips import find_viral_clips
from transcribe import transcribe_video

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "outputs"
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-matroska", "video/webm"}
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB, adjust to taste

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

app = FastAPI(title="Clipforge API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this to your actual frontend domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/clips", StaticFiles(directory=OUTPUT_DIR), name="clips")


# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------
# Simple dict guarded by a lock. Good enough for one server process / MVP
# traffic. See the module docstring for what to swap this for at scale.

_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _create_job(job_id: str) -> None:
    with _jobs_lock:
        _jobs[job_id] = {
            "status": "queued",   # queued | processing | done | failed
            "stage": "queued",    # queued | transcribing | selecting_clips | cutting_clips | done
            "clips": None,
            "error": None,
            "created_at": time.time(),
        }


def _update_job(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)


def _get_job(job_id: str) -> Optional[Dict[str, Any]]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------

def _run_pipeline(job_id: str, upload_path: str, job_output_dir: str) -> None:
    """
    The actual transcribe -> select -> cut pipeline, run outside the
    request/response cycle. Every meaningful step updates the job store so
    GET /jobs/{job_id} always reflects real progress.
    """
    try:
        _update_job(job_id, status="processing", stage="transcribing")
        transcript = transcribe_video(upload_path)
        if not transcript.strip():
            raise ValueError("Could not detect any speech in the video.")

        _update_job(job_id, stage="selecting_clips")
        clips = find_viral_clips(transcript)

        _update_job(job_id, stage="cutting_clips")
        results = []
        for i, clip in enumerate(clips, start=1):
            _update_job(job_id, stage=f"cutting_clip_{i}_of_{len(clips)}")

            filename = f"clip_{i:02d}.mp4"
            output_path = os.path.join(job_output_dir, filename)

            create_viral_short(
                video_path=upload_path,
                start_time=clip["start"],
                end_time=clip["end"],
                output_path=output_path,
            )

            results.append(
                {
                    "title": clip["title"],
                    "start": clip["start"],
                    "end": clip["end"],
                    "viral_score": clip["viral_score"],
                    "reason": clip["reason"],
                    "download_url": f"/clips/{job_id}/{filename}",
                }
            )

        _update_job(job_id, status="done", stage="done", clips=results)

    except Exception as exc:  # noqa: BLE001 - deliberately broad: this runs
        # unattended in a background thread, so any failure (bad transcript,
        # AI parsing error, ffmpeg failure, disk full, etc.) must be caught
        # and recorded rather than crashing silently with no one watching.
        _update_job(job_id, status="failed", stage="failed", error=str(exc))

    finally:
        # Clean up the original upload once processing is done, success or not.
        if os.path.exists(upload_path):
            os.remove(upload_path)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/process-video")
async def process_video(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """
    Accepts an uploaded video, schedules the pipeline as a background task,
    and returns a job_id immediately -- it does NOT wait for processing to
    finish. Poll GET /jobs/{job_id} for progress and the final result.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{file.content_type}'. Upload an MP4, MOV, MKV, or WebM file.",
        )

    job_id = str(uuid.uuid4())
    upload_path = os.path.join(UPLOAD_DIR, f"{job_id}.mp4")
    job_output_dir = os.path.join(OUTPUT_DIR, job_id)
    os.makedirs(job_output_dir, exist_ok=True)

    # Save the uploaded file to disk, streaming so large files don't have
    # to be held fully in memory first. This part still happens inline
    # (it's fast relative to transcription/AI/cutting) -- only the heavy
    # pipeline work is deferred to the background task below.
    bytes_written = 0
    with open(upload_path, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            bytes_written += len(chunk)
            if bytes_written > MAX_UPLOAD_BYTES:
                f.close()
                os.remove(upload_path)
                raise HTTPException(status_code=413, detail="File too large.")
            f.write(chunk)

    _create_job(job_id)
    background_tasks.add_task(_run_pipeline, job_id, upload_path, job_output_dir)

    return {"job_id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    """
    Poll this endpoint from the frontend (e.g. every 2-3 seconds) after
    calling /process-video. Example response shapes:

        {"status": "processing", "stage": "transcribing", "clips": null, "error": null}
        {"status": "done", "stage": "done", "clips": [...], "error": null}
        {"status": "failed", "stage": "failed", "clips": null, "error": "..."}
    """
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No job found with that id.")
    return job
