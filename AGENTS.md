# AGENTS.md

## What this repo does

`convert.js` reads a DJUCED library (`DJUCED.db`, SQLite) and produces a
Rekordbox-compatible collection XML (`output_rekordbox.xml`) that can be
imported via **Rekordbox → Preferences → Advanced → rekordbox xml**.

No build step, no npm dependencies. Node's built-in `node:sqlite` (Node 22.5+,
stable since Node 24) is used to query the database directly — there is no
intermediate JSON export step. Run with:

```bash
node convert.js
```

`DJUCED.db` is expected in the repo root (same dir as `convert.js`). It is
gitignored — it's the user's personal library, not project source.

## Why the previous approach was replaced

An earlier version exported `tracks.json` / `cues.json` / `playlists.json`
via a separate SQL step, then had `convert.js` consume those. It's gone:
cues weren't reliably making it through, the JSON could go stale vs the
live DB, and reading SQLite directly in Node removes an entire moving part.
Those JSON files and the two-step flow are dead — don't resurrect them.

## DJUCED.db schema notes (reverse-engineered + officially documented)

Official field documentation:
https://github.com/DJUCED/DJUCED_DJ/blob/main/doc/meta-tags.md
(covers the ID3/GEOB encodings DJUCED uses in audio files — the SQLite
columns mirror the same semantics).

### `tracks`
One row per track. `absolutepath` is the join key used by `trackCues` and
`trackBeats` (they don't use `tracks.id`, they use the file path as string).
`key` is an integer 0–23 — see Annexe A of meta-tags.md:

- `0..11` = major keys, chromatic starting at A: A, A#, B, C, C#, D, D#, E, F, F#, G, G#
- `12..23` = minor keys, same chromatic order: a, a#, b, c, c#, d, d#, e, f, f#, g, g#

`convert.js` maps this to Rekordbox's own flat-notation convention (verified
against a real Rekordbox-exported XML: flats everywhere except F#/F#m stay
sharp — Rekordbox never writes "Gb"). This key value is whatever DJUCED's
own audio analysis detected — it is not pulled from any external metadata
service, so occasional mismatches with sites like Tunebat (relative
major/minor confusion is the most common failure mode of key-detection
algorithms) are expected and not a bug in this script.

### `trackCues`
`trackId` = `tracks.absolutepath` (not a numeric id). `cuenumber` has two
distinct ranges that must not be conflated:

- `0..8`: real cue points a user placed in DJUCED. `0` is the main/memory
  cue, `1..8` are hot cue pads 1–8.
- `1000+`: auto-detected track-structure markers (DJUCED's own segmentation
  analysis, not something a DJ actually placed). **Never export these** —
  there can be dozens per track and they'd drown the real cues. `convert.js`
  filters with `WHERE cuenumber < 1000`.

Mapping to Rekordbox `POSITION_MARK`:
- `cuenumber == 0` → `Num="-1"` (memory cue, no color attributes)
- `cuenumber 1..8` → `Num="0".."7"` (hot cue pads A–H)
- `isSavedLoop=1` or `loopLength > 0` → export as `Type="4"` (loop) with
  `Start`/`End` instead of a plain `Type="0"` cue point. `loopLength` is in
  beats; convert to seconds via `loopLength * 60 / bpm`.

Hot cue **colors** are not derived from DJUCED's `cueColor` column — that
column's palette isn't documented anywhere and is overwhelmingly a single
default value in practice. `convert.js` assigns a fixed 8-color rainbow
palette by pad slot instead, purely for visual distinction after import.
Don't try to reverse-engineer `cueColor` further without new evidence.

### `trackBeats`
One row per analyzed track, `beatpos` = first beat position in seconds.
Used as `TEMPO Inizio` (Rekordbox needs an anchor point for the beatgrid).
`timesignature` is always `0` in observed data — treat as 4/4 always,
matching what DJUCED itself assumes (it has no per-track time signature UI).

### `playlists2`
`type` values seen: `2` = smart-playlist rule definition (JSON in `data`,
not needed for export), `3` = materialized playlist membership (`data` is
a track's `absolutepath`, `order_in_list` is 1-based and scoped per
playlist `name`), `5` = internal system list (`AllSongsUnalyzed`) — skip.

Every playlist in this DB — smart or not — has its resolved membership
available via `type=3` rows, so `convert.js` never evaluates the smart
playlist JSON rules itself. If a future DB has genuinely manual (non-smart)
playlists, they still show up as `type=3` rows the same way.

## Format decisions verified against a real Rekordbox export

`test-export-collection.xml` (gitignored — personal data) was a genuine
Rekordbox 7.2.14 export from the user's own library, used as ground truth
for: attribute order/casing on `TRACK`/`TEMPO`/`POSITION_MARK`, the
`Tonality` flat-vs-sharp convention, and `Location` URI percent-encoding
style. If Rekordbox's XML schema needs re-verification later, regenerate a
fresh export from Rekordbox (Advanced → rekordbox xml → collection) rather
than guessing from the official Pioneer XML PDF alone — the PDF describes
the schema, but real exports show the actual conventions in practice.

## Known gaps / non-goals

- `.ogg` and `.djs` files are skipped (unsupported by Rekordbox) and
  reported, not silently dropped.
- Missing-on-disk files (moved/renamed since DJUCED indexed them) are
  skipped and reported the same way.
- No loop-in/loop-out beyond cue-loops (DJUCED doesn't seem to store
  freestanding saved loops separately from cue points in this schema).
- Hot cue colors are cosmetic only, not a faithful DJUCED reproduction (see
  above).
