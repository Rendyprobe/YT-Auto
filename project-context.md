# Project Context — Faceless “Would You Rather” YouTube Shorts

## 1. Product Goal

Build a fault-tolerant Python pipeline that processes one pending row from `data/data.csv`, generates English TTS, renders a vertical split-screen quiz video, and uploads the finished video to YouTube.

CSV source columns:

```text
Topik,Opsi A,Opsi B,Persentase A,Persentase B
```

Do not rename or silently modify these source columns.

## 2. Non-Negotiable Rules

- Use Python 3.10+.
- Use only free tools and open-source client libraries. No paid API, paid asset, subscription, watermark, or proprietary editing application.
- Required stack:
  - `pandas` or Python’s built-in `csv`
  - `edge-tts`
  - `moviepy`
  - ImageMagick
  - `google-api-python-client` and Google’s OAuth libraries for YouTube Data API v3
- External services must stay within their free access/quota. `edge-tts` and YouTube are external services even though their required client libraries are open source.
- Keep modules small and single-purpose. Never generate the whole project in one response.
- Before changing code, inspect the existing files and preserve working behavior.
- Every public workflow and CLI entry point must use clear validation, structured logging, and targeted `try-except` blocks.
- Never use an empty `except`, silently swallow an exception, or print credentials/tokens.
- A failed step must not mark a job as successful.
- Use temporary files plus atomic rename for final state/manifest/video writes.
- Make reruns idempotent. Never re-upload an already uploaded `content_id` unless an explicit `--force` option is supplied.
- After each module, run its local tests, report the exact commands and results, then stop for approval.

## 3. Repository Layout

```text
faceless-wyr/
├── project-context.md
├── requirements.txt
├── .gitignore
├── config/
│   └── settings.example.json
├── data/
│   └── data.csv
├── state/
│   └── processing_state.json
├── credentials/
│   ├── client_secret.json        # local only; never commit
│   └── token.json                # generated locally; never commit
├── assets/
│   ├── backgrounds/
│   │   ├── images/
│   │   └── videos/
│   ├── fonts/
│   ├── music/
│   └── sfx/
├── output/
│   ├── audio/<content_id>/
│   ├── intermediate/<content_id>/
│   ├── videos/
│   └── jobs/<content_id>/manifest.json
├── logs/
├── scripts/
│   ├── common/
│   │   ├── config.py
│   │   ├── logging_utils.py
│   │   └── state_store.py
│   ├── data_audio.py
│   ├── video_layout.py
│   ├── compose_video.py
│   └── youtube_uploader.py
└── tests/
    ├── test_data_audio.py
    ├── test_video_layout.py
    ├── test_compose_video.py
    └── test_youtube_uploader.py
```

Create folders only when the current module needs them. Keep generated files out of source folders.

## 4. Job Identity and State

- Derive `content_id` deterministically from normalized `Topik`, `Opsi A`, and `Opsi B`, for example the first 12 characters of a SHA-256 hash.
- Keep processing metadata in `state/processing_state.json`; do not add tracking columns to the source CSV.
- Supported states:

```text
pending -> audio_processing -> audio_ready -> layout_ready
        -> rendering -> video_ready -> uploading -> uploaded
```

- Record failures with `failed_step`, a concise `error_message`, and `updated_at`; retain the last valid artifact paths.
- Write one `output/jobs/<content_id>/manifest.json` as the contract between modules. Store normalized row data, artifact paths, durations, current status, and later the YouTube video ID/URL.
- Validate all percentages as numbers from 0–100. Their sum should equal 100 within a small documented tolerance; otherwise fail with a useful message.

## 5. Video Specification

- Format: `1080x1920`, 9:16, 30 fps, H.264 video, AAC audio, `yuv420p`.
- Upper half: Option A background and large wrapped Option A text.
- Lower half: Option B background and large wrapped Option B text.
- Center line: high-contrast divider with the countdown centered over it.
- Topic/question: compact safe-area title near the top; it must not collide with Option A.
- Result reveal: Percentage A inside the upper half and Percentage B inside the lower half during the final countdown second.
- Use high contrast, text stroke/shadow, consistent padding, and a bundled/open-licensed local font.
- Keep critical text inside a conservative Shorts safe area; avoid the right-side UI region and bottom caption controls.
- Background images/videos must be crop-to-fill, never stretched. Loop or trim video backgrounds as needed and mute their original audio.
- If only one background exists, reuse it with different crop/offset treatment. If no valid background exists, fail with actionable guidance.

Approximate composition:

```text
┌────────────────────────────┐
│      WOULD YOU RATHER?     │
│                            │
│          OPTION A          │
│      [Percentage A]        │
├──────────── 5 ─────────────┤
│      [Percentage B]        │
│          OPTION B          │
│                            │
└────────────────────────────┘
```

## 6. Timeline Contract

- Use actual TTS clip durations; never hard-code speech length.
- Default timeline:
  1. `0.25 s` pre-roll.
  2. Play Option A TTS.
  3. `0.35 s` pause.
  4. Play Option B TTS.
  5. `0.50 s` pause.
  6. Run a five-second countdown displaying `5, 4, 3, 2, 1`.
  7. Reveal both percentages during the final countdown second.
  8. Hold the result for `0.75 s`.
- Put timeline values in configuration, not scattered magic numbers.

## 7. Configuration and Secrets

- Use `config/settings.example.json` for safe defaults and copy it locally to `config/settings.json`.
- Allow CLI arguments to override config values.
- Keep `config/settings.json`, `credentials/client_secret.json`, `credentials/token.json`, logs, state, and generated output out of Git as appropriate.
- Never hard-code OAuth credentials, access tokens, absolute user-specific paths, or YouTube channel IDs.
- YouTube upload privacy defaults to `private`; changing it to `unlisted` or `public` must be explicit.

## 8. Testing and Definition of Done

- Unit tests must not require a real YouTube upload.
- Mock `edge-tts` and YouTube API calls in automated tests; provide an optional clearly labeled network smoke test.
- Include a low-resolution/short `--preview` render path for fast local validation.
- Verify output existence, nonzero file size, duration, dimensions, fps, and presence of an audio track.
- Each module is complete only when:
  - its tests pass;
  - its CLI help works;
  - one happy-path local example succeeds;
  - at least one expected failure produces a clear log and nonzero exit code;
  - the manifest/state changes only after the artifact is successfully created.
