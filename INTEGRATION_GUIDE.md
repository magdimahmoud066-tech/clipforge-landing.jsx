# Clipforge — App Integration Guide

This ties together everything built so far:

| Piece | File | Role |
|---|---|---|
| Frontend | `clipforge-landing.jsx` | Landing page + dashboard UI (React artifact) |
| Transcription | `transcribe.py` | Video → timestamped transcript (local Whisper) |
| AI clip selection | `find_viral_clips.py` | Transcript → top 3 viral segments (Claude API) |
| Video cutting | `create_viral_short.py` | Segment → vertical 9:16 MP4 (MoviePy) |
| Backend glue | `app.py` | FastAPI endpoint wiring the three steps together |

**Flow:** user uploads a video in the dashboard → frontend `POST`s it to
`/process-video` → backend transcribes it, asks Claude for the best
moments, cuts each one with MoviePy → backend returns clip metadata +
download URLs → dashboard renders the clip cards.

---

## 1. Project layout

Put all four Python files in the same folder:

```
clipforge-backend/
├── app.py
├── transcribe.py
├── find_viral_clips.py
├── create_viral_short.py
├── uploads/        # created automatically at runtime
└── outputs/         # created automatically at runtime
```

---

## 2. Setup — PC (macOS / Linux / Windows)

```bash
# 1. System dependency: ffmpeg (needed by both Whisper and MoviePy)
#    macOS:
brew install ffmpeg
#    Ubuntu/Debian:
sudo apt-get update && sudo apt-get install -y ffmpeg
#    Windows: download from https://ffmpeg.org/download.html and add
#    the /bin folder to your PATH

# 2. Create and activate a virtual environment
python3 -m venv venv
source venv/bin/activate           # Windows: venv\Scripts\activate

# 3. Install Python dependencies
pip install "moviepy>=2.0" anthropic openai-whisper \
            fastapi "uvicorn[standard]" python-multipart

# 4. Set your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-your-key-here"    # Windows: set ANTHROPIC_API_KEY=...

# 5. Run the server
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```

The API is now live at `http://localhost:8000`. Test it:

```bash
curl -X POST http://localhost:8000/process-video \
     -F "file=@/path/to/your/video.mp4"
```

---

## 3. Setup — Termux (Android)

Mobile hardware changes the calculus a bit, so read the note after the
commands before you run a real video through this.

```bash
# 1. Update Termux and install system packages
pkg update -y && pkg upgrade -y
pkg install -y python ffmpeg git clang rust binutils

# 2. Create a virtual environment
python -m venv venv
source venv/bin/activate

# 3. Install Python dependencies
pip install "moviepy>=2.0" anthropic fastapi "uvicorn[standard]" python-multipart

# openai-whisper depends on PyTorch, which is heavy and can be slow or
# fail to build on some Android/ARM setups. Install it separately so a
# failure here doesn't block the rest of your stack:
pip install openai-whisper

# 4. Set your API key
export ANTHROPIC_API_KEY="sk-ant-your-key-here"

# 5. Run the server
uvicorn app:app --host 0.0.0.0 --port 8000
```

**Mobile hardware note:** Whisper (even the `tiny` model) is a real neural
network doing CPU inference — expect transcription to be noticeably
slower on a phone than a laptop, and long videos (30+ minutes) may take
several minutes just for that step. Two ways to make this comfortable
on-device:

- In `transcribe.py`, call `transcribe_video(path, model_size="tiny")`
  instead of the default `"base"` — much faster, modest accuracy loss.
- Or skip local Whisper entirely on mobile: swap `transcribe_video()`'s
  internals for a call to a hosted transcription API (AssemblyAI,
  Deepgram, etc.). Since `find_viral_clips()` only cares about receiving
  a timestamped transcript *string*, this is a drop-in change — nothing
  else in the pipeline needs to know where the transcript came from.

---

## 4. Calling the API from the React dashboard

This is what your dashboard's upload handler would actually send instead
of the simulated `setTimeout` demo:

```javascript
async function processVideo(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("http://localhost:8000/process-video", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Processing failed: ${response.statusText}`);
  }

  const { job_id, clips } = await response.json();
  // clips = [{ title, start, end, viral_score, reason, download_url }, ...]
  // download_url is relative, e.g. "/clips/<job_id>/clip_01.mp4" —
  // prefix it with your API's base URL to build a playable/downloadable link.
  return clips;
}
```

---

## 5. Going to production (when you're past local testing)

The setup above is deliberately simple for development. Before real
users hit it, plan for:

- **Background processing** — `/process-video` currently blocks until
  transcription + AI selection + cutting all finish, which can be minutes
  for a long video. Move the pipeline into a background job (Celery + Redis,
  or FastAPI's `BackgroundTasks` for a lighter-weight start) so the endpoint
  returns a `job_id` immediately, and add a `GET /jobs/{job_id}` the
  frontend can poll for status.
- **Object storage** — swap the local `outputs/` folder for S3 (or similar)
  so clips survive server restarts and scale past one machine's disk.
- **Auth** — the CORS config (`allow_origins=["*"]`) and open upload
  endpoint are fine for local testing, not for a public deployment. Lock
  CORS down to your real frontend domain, and add an API key or session
  check in front of `/process-video`.
- **Cost control** — cap video length/file size server-side (the 2 GB
  check in `app.py` is a start), since both Whisper compute time and
  Claude API tokens scale with transcript length.
