# DJUCED → Rekordbox

Converts a DJUCED DJ library into a Rekordbox XML collection: tracks,
metadata, hot cues, memory cues, saved-loop cues, beatgrid and playlists.

## Requirements

- Node.js 22.5+ (uses the built-in `node:sqlite` module — no npm install,
  no dependencies at all).
- Your `DJUCED.db` file, usually at `~/Documents/DJUCED/DJUCED.db` (macOS).

## Usage

1. Copy your `DJUCED.db` into this folder (or symlink it).
2. Run:
   ```bash
   node convert.js
   ```
3. This produces `output_rekordbox.xml` in the same folder, and prints a
   summary of any tracks it had to skip (missing files, unsupported
   formats like `.ogg`/`.djs`).

## Importing into Rekordbox

1. Open Rekordbox → **Preferences → Advanced → rekordbox xml** → select
   `output_rekordbox.xml`.
2. In the left sidebar, open the **rekordbox xml** tab — your DJUCED
   playlists appear there.
3. Drag a playlist into your main collection to import it.

Rekordbox will still run its own analysis on first play (waveform, etc.)
but should respect the imported beatgrid anchor, key, and cue points.

## What gets carried over

- Title, artist, album, genre, composer, track number, year, comment,
  rating, play count, BPM, bitrate, sample rate, file size.
- Musical key (translated from DJUCED's own detected key — see below).
- Memory cue + hot cues 1–8, including cue points that also trigger a
  saved loop.
- Beatgrid anchor (first beat position).
- Playlists (including DJUCED "smart" playlists — exported as their
  already-resolved membership, not as live rules).

## What doesn't

- `.ogg` recordings (DJUCED's own recorded mix sessions) and `.djs` files
  aren't audio formats Rekordbox understands, so they're skipped.
- Tracks whose file has moved/been deleted since DJUCED indexed them are
  skipped (reported by path so you can relocate them if you want).
- Hot cue colors are just a fixed 8-color palette assigned by pad number,
  not a reproduction of whatever color you picked in DJUCED — DJUCED
  doesn't document its color palette anywhere.
- Musical key is whatever DJUCED's own audio analysis detected. It won't
  always match what you'd find on a site like Tunebat — that's a DJUCED
  key-detection accuracy question, not something this script can fix.

See [AGENTS.md](AGENTS.md) for the technical detail (DB schema, exact
field mappings, and why certain data ranges are deliberately excluded).
