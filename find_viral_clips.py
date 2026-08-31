"""
find_viral_clips.py
=====================

Sends a timestamped video transcript to an LLM and asks it to identify the
top N most "viral"/engaging segments, returned as strict JSON so it can be
fed directly into create_viral_short() (see create_viral_short.py).

--------------------------------------------------------------------------
INSTALLATION
--------------------------------------------------------------------------
    pip install anthropic          # primary implementation (used below)
    pip install google-generativeai  # only needed if you use the Gemini variant

Set your API key as an environment variable (never hardcode it):
    export ANTHROPIC_API_KEY="sk-ant-..."
    # or, for the Gemini variant:
    export GOOGLE_API_KEY="..."

--------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------
    from find_viral_clips import find_viral_clips
    from create_viral_short import create_viral_short

    transcript = '''
    [00:00] Welcome back to the show, today we're talking about...
    [02:14] Here's the thing nobody tells you about scaling a business...
    ...
    '''

    clips = find_viral_clips(transcript, video_path="podcast_full.mp4")

    for clip in clips:
        output_path = f"clips/{clip['title'][:40].replace(' ', '_')}.mp4"
        create_viral_short(
            video_path="podcast_full.mp4",
            start_time=clip["start"],
            end_time=clip["end"],
            output_path=output_path,
        )
        print(f"[{clip['viral_score']}] {clip['title']} -> {output_path}")
--------------------------------------------------------------------------
"""

import json
import os
import re
from typing import List, Dict, Any, Optional

from anthropic import Anthropic

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# claude-sonnet-5 is a good balance of transcript-reasoning quality and cost
# for a job like this that runs once per uploaded video. Swap to
# claude-opus-5 if you want deeper reasoning on longer/messier transcripts,
# or claude-haiku-4-5-20251001 for a cheaper/faster first pass.
MODEL = "claude-sonnet-5"

MAX_CLIPS = 3
MIN_CLIP_SECONDS = 15
MAX_CLIP_SECONDS = 60


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

def _build_prompt(transcript: str, num_clips: int) -> str:
    """
    Build the instruction prompt sent to the model. The instructions are
    intentionally strict and enumerated so the model has an explicit
    rubric to score against, rather than a vague "find good clips" ask.
    """
    return f"""You are an expert short-form video editor who has cut hundreds
of viral TikTok, Reels, and YouTube Shorts clips from long-form podcasts,
interviews, and talks.

Below is a timestamped transcript of a long-form video. Your job is to find
the {num_clips} BEST segments to cut into standalone short-form clips.

Judge every candidate segment strictly against these criteria:

1. HOOK / EMOTIONAL SPIKE: The first 1-2 seconds of the segment must grab
   attention immediately -- a bold claim, a surprising fact, an emotional
   beat, or a question that creates curiosity. Do not pick a segment that
   opens mid-thought or with throat-clearing ("so yeah", "um, anyway").
2. COMPLETE, COHERENT THOUGHT: The segment must work as a standalone story
   or idea with a beginning, middle, and a payoff/punchline/conclusion --
   understandable with zero context from the rest of the video -- and it
   must fit in under 60 seconds.
3. SHAREABILITY: Prioritize moments a viewer would screenshot, send to a
   friend, or comment on -- controversial opinions, surprising data,
   relatable struggles, funny exchanges, or concrete actionable advice.

Rules:
- Segment length must be between {MIN_CLIP_SECONDS} and {MAX_CLIP_SECONDS} seconds.
- Use the exact timestamps from the transcript (convert them to seconds).
- Do not let segments overlap.
- viral_score is your own confidence rating from 0-100 that this clip
  would outperform a random clip from this same video.
- "reason" should be one specific sentence -- reference what actually
  happens in that segment, not a generic statement.

Return ONLY a JSON array (no prose before or after it, no markdown code
fences) in exactly this shape:

[
  {{"title": "Clip Title", "start": 65.0, "end": 115.0, "viral_score": 95, "reason": "Why it's viral"}}
]

TRANSCRIPT:
{transcript}
"""


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _extract_json_array(raw_text: str) -> List[Dict[str, Any]]:
    """
    Defensively pull a JSON array out of the model's raw text response.
    Even with an explicit "JSON only" instruction, models occasionally wrap
    output in markdown fences or add a stray sentence -- this strips that
    without failing the whole pipeline over formatting noise.
    """
    text = raw_text.strip()

    # Strip ```json ... ``` or ``` ... ``` fences if present.
    fence_match = re.search(r"```(?:json)?\s*(\[.*\])\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1)
    elif not text.startswith("["):
        # Fall back to grabbing the first [...] block in the text.
        bracket_match = re.search(r"\[.*\]", text, re.DOTALL)
        if bracket_match:
            text = bracket_match.group(0)

    return json.loads(text)


def _validate_clip(clip: Dict[str, Any]) -> bool:
    """Sanity-check one clip dict before it's trusted by the rest of the pipeline."""
    required_keys = {"title", "start", "end", "viral_score", "reason"}
    if not required_keys.issubset(clip.keys()):
        return False
    if not isinstance(clip["start"], (int, float)) or not isinstance(clip["end"], (int, float)):
        return False
    if clip["end"] <= clip["start"]:
        return False
    if not (0 <= clip["viral_score"] <= 100):
        return False
    return True


# ---------------------------------------------------------------------------
# Main entry point (Anthropic / Claude)
# ---------------------------------------------------------------------------

def find_viral_clips(
    transcript: str,
    num_clips: int = MAX_CLIPS,
    api_key: Optional[str] = None,
    model: str = MODEL,
) -> List[Dict[str, Any]]:
    """
    Ask Claude to identify the top `num_clips` viral segments in a
    timestamped transcript.

    Parameters
    ----------
    transcript : str
        The full timestamped transcript text, e.g. lines like
        "[02:14] Here's the thing nobody tells you about scaling...".
    num_clips : int
        How many clips to request. Defaults to 3.
    api_key : str, optional
        Anthropic API key. If omitted, reads from the ANTHROPIC_API_KEY
        environment variable (the SDK default).
    model : str
        Which Claude model to use. See MODEL config above for guidance.

    Returns
    -------
    List[Dict[str, Any]]
        A list of clip dicts: {"title", "start", "end", "viral_score", "reason"}
        sorted by viral_score descending, ready to pass straight into
        create_viral_short().

    Raises
    ------
    ValueError
        If the model's response could not be parsed into valid clip data.
    """
    client = Anthropic(api_key=api_key) if api_key else Anthropic()

    prompt = _build_prompt(transcript, num_clips)

    response = client.messages.create(
        model=model,
        max_tokens=1024,
        temperature=0.3,  # low temperature: we want consistent, grounded picks, not creative variety
        messages=[
            {"role": "user", "content": prompt},
            # Prefilling the assistant turn with "[" strongly biases Claude
            # toward emitting a raw JSON array immediately, with no
            # preamble -- a standard trick for reliable structured output.
            {"role": "assistant", "content": "["},
        ],
    )

    raw_text = "[" + response.content[0].text  # re-attach the prefill we primed

    try:
        clips = _extract_json_array(raw_text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Could not parse a JSON array from the model's response. "
            f"Raw response was:\n{raw_text}"
        ) from exc

    valid_clips = [c for c in clips if _validate_clip(c)]
    if not valid_clips:
        raise ValueError(f"Model returned no valid clips. Raw response was:\n{raw_text}")

    valid_clips.sort(key=lambda c: c["viral_score"], reverse=True)
    return valid_clips[:num_clips]


# ---------------------------------------------------------------------------
# Optional variant: Google Gemini
# ---------------------------------------------------------------------------
# Same prompt, same JSON contract -- swap this in if you'd rather standardize
# on Gemini instead of (or as a fallback alongside) Claude.

def find_viral_clips_gemini(
    transcript: str,
    num_clips: int = MAX_CLIPS,
    api_key: Optional[str] = None,
    model: str = "gemini-2.5-pro",
) -> List[Dict[str, Any]]:
    import google.generativeai as genai

    genai.configure(api_key=api_key or os.environ["GOOGLE_API_KEY"])
    gemini_model = genai.GenerativeModel(
        model,
        generation_config={"response_mime_type": "application/json"},  # forces valid JSON output
    )

    prompt = _build_prompt(transcript, num_clips)
    response = gemini_model.generate_content(prompt)

    try:
        clips = _extract_json_array(response.text)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Could not parse a JSON array from Gemini's response. Raw response was:\n{response.text}"
        ) from exc

    valid_clips = [c for c in clips if _validate_clip(c)]
    if not valid_clips:
        raise ValueError(f"Gemini returned no valid clips. Raw response was:\n{response.text}")

    valid_clips.sort(key=lambda c: c["viral_score"], reverse=True)
    return valid_clips[:num_clips]


# ---------------------------------------------------------------------------
# Full pipeline example: transcript -> AI selection -> MoviePy cutting
# ---------------------------------------------------------------------------

def process_video_end_to_end(video_path: str, transcript: str, output_dir: str = "clips") -> List[Dict[str, Any]]:
    """
    Ties this file to create_viral_short.py: ask the AI for the best
    segments, then physically cut + reframe each one to vertical 9:16.

    Returns the clip metadata list (with an added "output_path" per clip)
    so it can be handed straight to your dashboard/API layer.
    """
    # Imported here (not at module level) so this file has no hard
    # dependency on moviepy unless you actually call this function.
    from create_viral_short import create_viral_short

    clips = find_viral_clips(transcript)
    os.makedirs(output_dir, exist_ok=True)

    for i, clip in enumerate(clips, start=1):
        safe_title = re.sub(r"[^a-zA-Z0-9]+", "_", clip["title"]).strip("_")[:40]
        output_path = os.path.join(output_dir, f"clip_{i:02d}_{safe_title}.mp4")

        create_viral_short(
            video_path=video_path,
            start_time=clip["start"],
            end_time=clip["end"],
            output_path=output_path,
        )
        clip["output_path"] = output_path
        print(f"[{clip['viral_score']}] {clip['title']} ({clip['start']}s-{clip['end']}s) -> {output_path}")

    return clips


if __name__ == "__main__":
    # Minimal smoke test with a fake transcript -- replace with a real one,
    # or wire this up to your transcription step (e.g. Whisper/AssemblyAI).
    sample_transcript = """
    [00:00] Welcome back to the show. Today we're joined by someone who built a seven figure business from nothing.
    [02:14] Here's the thing nobody tells you about scaling: the moment you hire your first employee, your job completely changes.
    [02:48] You go from being the best at the work to being the best at building the system around the work.
    [11:47] I almost gave up right here. I had three months of runway left and zero paying customers.
    [12:08] Then one cold email changed everything.
    """

    clips = find_viral_clips(sample_transcript)
    print(json.dumps(clips, indent=2))
