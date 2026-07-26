# YT Auto Web Dashboard

The dashboard has two data modes:

- **Local live:** reads `state/processing_state.json` and manifests under
  `output/jobs/`, then serves local audio/video with HTTP range support.
- **Public snapshot:** reads the sanitized `dashboard-data/jobs.json` committed
  to GitHub. Local filesystem paths, credentials, tokens, logs, and generated
  media are never included.

## Run locally

Use Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. When a final file exists at
`output/videos/<content_id>.mp4`, its player appears automatically.

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

## Credentials

The dashboard itself needs no API key. Do not put secrets in
`dashboard-data/jobs.json`, `.openai/hosting.json`, or any `NEXT_PUBLIC_*`
environment variable.
