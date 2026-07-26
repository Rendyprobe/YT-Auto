# YT Auto Web Dashboard

The dashboard has two data modes:

- **Local live:** reads `state/processing_state.json` and manifests under
  `output/jobs/`, then serves local audio/video with HTTP range support.
- **Public snapshot:** reads the sanitized `dashboard-data/jobs.json` committed
  to GitHub. Local filesystem paths, credentials, tokens, logs, and generated
  media are never included.

It has three screens:

- **Overview:** pipeline states, audio status, errors, and selected-job details.
- **Queue editor:** add, edit, delete, and reorder the rows in `data/data.csv`.
- **Video library:** play/download local MP4 files or open completed YouTube
  uploads.

Changing `Topik`, `Opsi A`, or `Opsi B` creates a new deterministic
`content_id`. Previous artifacts remain available and are not deleted
automatically.

## Run locally

Use Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. When a final file exists at
`output/videos/<content_id>.mp4`, its player appears automatically.

`npm run dev` enables local CSV editing automatically. For a production-style
local server, use:

```bash
YT_AUTO_LOCAL_CONTROL=1 PIPELINE_ROOT=. npm start
```

If the dashboard is launched from another working directory, set
`PIPELINE_ROOT` to the repository root.

## Refresh the public status snapshot

```bash
python -m scripts.export_dashboard
git add dashboard-data/jobs.json
git commit -m "chore: refresh dashboard status"
git push
```

The deployed dashboard checks the public GitHub snapshot every 30 seconds.
Generated MP4 files are intentionally not committed to GitHub. The public
player uses a YouTube URL after upload; use the local dashboard to review a
video before upload.

## Enable online queue editing

Without a server-side GitHub token, the deployed Queue Editor is read-only and
offers a CSV download. To save changes directly from the private deployed site,
create a fine-grained GitHub personal access token restricted to
`Rendyprobe/YT-Auto` with **Contents: Read and write**, then store it as the
secret environment variable `YT_AUTO_GITHUB_TOKEN` in the site settings.

Safe non-secret environment values:

```text
YT_AUTO_GITHUB_REPOSITORY=Rendyprobe/YT-Auto
YT_AUTO_GITHUB_BRANCH=main
```

Never paste the token into source code, chat, `NEXT_PUBLIC_*`, or
`.openai/hosting.json`. After the online editor commits a queue change, the
local pipeline machine must pull `main` before processing the next row.

## Credentials

The dashboard itself needs no API key. Do not put secrets in
`dashboard-data/jobs.json`, `.openai/hosting.json`, or any `NEXT_PUBLIC_*`
environment variable.
