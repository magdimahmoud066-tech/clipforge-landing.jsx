"""
create_viral_short.py
======================

Cuts a segment out of a long horizontal (16:9) video and reframes it into a
vertical (9:16) clip suitable for TikTok, Instagram Reels, and YouTube Shorts.

--------------------------------------------------------------------------
INSTALLATION
--------------------------------------------------------------------------
This script uses MoviePy (which wraps FFmpeg) for video I/O and encoding.

1. Install FFmpeg on your system (MoviePy needs it on the PATH):
     - macOS:          brew install ffmpeg
     - Ubuntu/Debian:  sudo apt-get install ffmpeg
     - Windows:         download from https://ffmpeg.org/download.html
                         and add the /bin folder to your PATH

2. Install the Python dependencies (ideally inside a virtual environment):
     python -m venv venv
     source venv/bin/activate        # Windows: venv\\Scripts\\activate
     pip install "moviepy>=2.0" pillow numpy

   Note: this script targets the MoviePy 2.x API (VideoFileClip.subclipped /
   .resized / .cropped). If you are pinned to MoviePy 1.x, see the
   MOVIEPY 1.x COMPATIBILITY note near the bottom of the file.

--------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------
As a script (edit the __main__ block below, or pass args on the CLI):

    python create_viral_short.py input.mp4 134 168 output_clip.mp4

    # 134 = start_time in seconds (02:14)
    # 168 = end_time in seconds   (02:48)

As a function import in your own pipeline (e.g. called once per clip that
your AI moment-detection step returns):

    from create_viral_short import create_viral_short

    create_viral_short(
        video_path="podcast_full.mp4",
        start_time=134,
        end_time=168,
        output_path="clips/clip_01_vertical.mp4",
    )
--------------------------------------------------------------------------
"""

import argparse
import os
import sys

from moviepy import VideoFileClip

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# Standard vertical short-form target resolution (9:16).
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1920

# libx264 CRF: lower = higher quality / bigger file. 21-23 is a good balance
# of quality vs. file size for social platforms that re-compress on upload.
VIDEO_CRF = "22"

# Encoding preset trades encode speed for compression efficiency.
# "medium" is a reasonable default for a batch backend job; use "fast" or
# "veryfast" if you need higher throughput and can accept slightly larger files.
ENCODING_PRESET = "medium"


def create_viral_short(
    video_path: str,
    start_time: float,
    end_time: float,
    output_path: str,
) -> str:
    """
    Extract a segment from a horizontal source video and export it reframed
    to a vertical 9:16 clip, ready for TikTok / Reels / Shorts.

    Parameters
    ----------
    video_path : str
        Path to the original horizontal (16:9) source video.
    start_time : float
        Clip start time in seconds, relative to the source video.
    end_time : float
        Clip end time in seconds, relative to the source video.
    output_path : str
        Where to write the final vertical .mp4 file. Parent directories are
        created automatically if they don't exist.

    Returns
    -------
    str
        The output_path, on success (useful for chaining in a pipeline).

    Raises
    ------
    FileNotFoundError
        If video_path does not exist.
    ValueError
        If the requested time range is invalid.
    """
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"Source video not found: {video_path}")

    if start_time < 0 or end_time <= start_time:
        raise ValueError(
            f"Invalid time range: start_time={start_time}, end_time={end_time}. "
            "end_time must be greater than start_time, and both must be >= 0."
        )

    # Make sure the output directory exists before we try to write to it.
    output_dir = os.path.dirname(output_path)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    source_clip = None
    trimmed_clip = None
    vertical_clip = None

    try:
        # 1. Load the original horizontal video.
        source_clip = VideoFileClip(video_path)

        if end_time > source_clip.duration:
            raise ValueError(
                f"end_time ({end_time}s) exceeds source video duration "
                f"({source_clip.duration:.2f}s)."
            )

        # 2. Cut the clip down to the requested [start_time, end_time] window.
        trimmed_clip = source_clip.subclipped(start_time, end_time)

        # 3. Reframe to vertical 9:16, keeping the center of the frame.
        #
        #    Strategy: scale the clip UP so its height matches the target
        #    vertical height (1920px), then center-crop the width down to
        #    the target width (1080px). Scaling by height first (rather than
        #    naively squashing to 1080x1920) preserves the original aspect
        #    ratio and avoids stretching/distorting people or objects in
        #    frame -- it just crops the left/right edges, which is the
        #    standard "smart center crop" approach for 16:9 -> 9:16.
        scale_factor = TARGET_HEIGHT / trimmed_clip.h
        resized_clip = trimmed_clip.resized(scale_factor)

        # After scaling, resized_clip.h == TARGET_HEIGHT (1920) and
        # resized_clip.w will be >= TARGET_WIDTH for a 16:9 source, so we
        # can safely center-crop the width.
        vertical_clip = resized_clip.cropped(
            width=TARGET_WIDTH,
            height=TARGET_HEIGHT,
            x_center=resized_clip.w / 2,
            y_center=resized_clip.h / 2,
        )

        # 4. Export with encoding settings tuned for fast, compatible web
        #    playback:
        #    - H.264 video / AAC audio: universally supported by browsers,
        #      TikTok, Instagram, and YouTube uploaders.
        #    - faststart: moves the MP4 metadata (moov atom) to the front of
        #      the file so it can start playing before the whole file has
        #      downloaded -- important for web/app preview players.
        #    - threads: use multiple CPU cores to speed up encoding.
        vertical_clip.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            preset=ENCODING_PRESET,
            ffmpeg_params=["-crf", VIDEO_CRF, "-movflags", "+faststart"],
            threads=os.cpu_count() or 4,
            audio_bitrate="128k",
            logger=None,  # suppress MoviePy's verbose per-frame progress bar
        )

    finally:
        # Always release file handles / decoders, even if an error occurred
        # partway through -- important in a backend service processing many
        # videos back to back, or file locks and memory will leak.
        for clip in (vertical_clip, resized_clip if 'resized_clip' in locals() else None,
                     trimmed_clip, source_clip):
            if clip is not None:
                clip.close()

    return output_path


# ---------------------------------------------------------------------------
# MOVIEPY 1.x COMPATIBILITY
# ---------------------------------------------------------------------------
# If you're stuck on moviepy 1.x, the equivalent calls are:
#
#   from moviepy.editor import VideoFileClip
#   from moviepy.video.fx.all import crop
#
#   trimmed_clip = source_clip.subclip(start_time, end_time)
#   resized_clip = trimmed_clip.resize(height=TARGET_HEIGHT)
#   vertical_clip = crop(
#       resized_clip,
#       width=TARGET_WIDTH, height=TARGET_HEIGHT,
#       x_center=resized_clip.w / 2, y_center=resized_clip.h / 2,
#   )
#   vertical_clip.write_videofile(
#       output_path, codec="libx264", audio_codec="aac",
#       preset=ENCODING_PRESET,
#       ffmpeg_params=["-crf", VIDEO_CRF, "-movflags", "+faststart"],
#       threads=os.cpu_count() or 4, audio_bitrate="128k", verbose=False,
#       logger=None,
#   )
# ---------------------------------------------------------------------------


def _parse_args():
    parser = argparse.ArgumentParser(
        description="Cut a segment from a horizontal video and export it as a vertical 9:16 short."
    )
    parser.add_argument("video_path", help="Path to the source horizontal video.")
    parser.add_argument("start_time", type=float, help="Clip start time in seconds.")
    parser.add_argument("end_time", type=float, help="Clip end time in seconds.")
    parser.add_argument("output_path", help="Path to write the output vertical .mp4 file.")
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()

    try:
        result_path = create_viral_short(
            video_path=args.video_path,
            start_time=args.start_time,
            end_time=args.end_time,
            output_path=args.output_path,
        )
        print(f"Vertical clip saved to: {result_path}")
    except (FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
