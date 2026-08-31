"""
transcribe.py
==============

Turns a raw video file into the timestamped transcript text that
find_viral_clips.find_viral_clips() expects, e.g.:

    [00:00] Welcome back to the show...
    [02:14] Here's the thing nobody tells you about scaling...

Uses OpenAI's local Whisper model (openai-whisper), so it needs no external
API key and works fully offline -- important since app.py may already be
sending video content to Claude/Gemini for clip selection, and you may not
want the raw audio going to a third transcription service too.

Install:
    pip install openai-whisper

Note on model size vs. hardware:
    "tiny"  -- fastest, least accurate, ~1GB RAM. Good for phones/Termux.
    "base"  -- good balance for most laptops/servers (default below).
    "small"/"medium"/"large" -- progressively slower and more accurate,
        want a real GPU or a lot of patience on CPU.
"""

import whisper

# Cache loaded models in memory so repeated calls in the same process
# (e.g. multiple requests to a running FastAPI server) don't reload the
# model from disk every time -- that reload is the slowest part by far.
_model_cache = {}


def transcribe_video(video_path: str, model_size: str = "base") -> str:
    """
    Transcribe a video's audio track into timestamped transcript text.

    Parameters
    ----------
    video_path : str
        Path to the video file. Whisper reads the audio track directly
        (via ffmpeg under the hood), no separate audio extraction needed.
    model_size : str
        Which Whisper model to load. See module docstring for guidance.

    Returns
    -------
    str
        Multi-line transcript, one line per detected speech segment,
        each prefixed with a [MM:SS] timestamp.
    """
    if model_size not in _model_cache:
        _model_cache[model_size] = whisper.load_model(model_size)
    model = _model_cache[model_size]

    result = model.transcribe(video_path, verbose=False)

    lines = []
    for segment in result["segments"]:
        minutes, seconds = divmod(int(segment["start"]), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}] {segment['text'].strip()}")

    return "\n".join(lines)
