#!/usr/bin/env python3
"""Prepare song audio and a manifest indexed by the source YouTube video ID.

Requires yt-dlp and FFmpeg to download/convert. Only process material you are
permitted to use. For --manifest-only, only Python's standard library is needed.

Examples:
  python scripts/prepare_song_audio.py --limit 3
  python scripts/prepare_song_audio.py --all
  python scripts/prepare_song_audio.py --manifest-only --base-url https://your-cdn.example/audio
"""
import argparse
import csv
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]


def youtube_id(link: str):
    link = link.strip()
    if re.fullmatch(r"[\w-]{11}", link):
        return link
    parsed = urlparse(link)
    candidate = parse_qs(parsed.query).get("v", [""])[0]
    if re.fullmatch(r"[\w-]{11}", candidate):
        return candidate
    for part in reversed(parsed.path.split("/")):
        if re.fullmatch(r"[\w-]{11}", part):
            return part
    return None


def main():
    parser = argparse.ArgumentParser(description="Batch audio preparation for PickYourStars")
    parser.add_argument("--csv", type=Path, default=ROOT / "public/songs.csv")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "public/audio")
    parser.add_argument("--manifest", type=Path, default=ROOT / "public/audio-manifest.json")
    parser.add_argument("--base-url", default="audio", help="Public directory prefix in manifest; e.g. audio or https://cdn.example/audio")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--limit", type=int, default=3, help="Number of new downloads (default: 3 for a smoke test)")
    group.add_argument("--all", action="store_true", help="Process all songs")
    parser.add_argument("--manifest-only", action="store_true", help="Regenerate JSON for files already on disk")
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with args.csv.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    songs = []
    seen = set()
    for row in rows:
        url = (row.get("youtube") or row.get("url") or row.get("video") or "").strip()
        vid = youtube_id(url)
        if vid and vid not in seen:
            seen.add(vid)
            songs.append((vid, url))

    if not args.manifest_only:
        executable = shutil.which("yt-dlp")
        if not executable:
            parser.error("yt-dlp executable not found. Install yt-dlp and FFmpeg, or run with --manifest-only.")
        if not shutil.which("ffmpeg"):
            parser.error("FFmpeg executable not found: needed for MP3 conversion.")
        processed = 0
        for vid, url in songs:
            dest = args.output_dir / f"{vid}.mp3"
            if dest.exists() and dest.stat().st_size > 0:
                continue
            if not args.all and processed >= args.limit:
                break
            processed += 1
            print(f"[{processed}] {vid}", flush=True)
            result = subprocess.run([
                executable, "--no-playlist", "-x", "--audio-format", "mp3",
                "--audio-quality", "192K", "--no-progress", "--no-overwrites",
                "-o", str(args.output_dir / f"{vid}.%(ext)s"), url,
            ], check=False)
            if result.returncode:
                print(f"WARN: failed to process {vid}")

    base = args.base_url.rstrip("/")
    videos = {
        vid: f"{base}/{vid}.mp3"
        for vid, _ in songs
        if (args.output_dir / f"{vid}.mp3").is_file() and (args.output_dir / f"{vid}.mp3").stat().st_size > 0
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({"videos": videos}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Manifest: {args.manifest} ({len(videos)} / {len(songs)} tracks)")


if __name__ == "__main__":
    main()
