"""Export a sanitized pipeline snapshot for the public web dashboard."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from scripts.common.csv_jobs import (
    CSVInputError,
    RowValidationError,
    ValidatedRow,
    read_valid_rows,
)
from scripts.common.logging_utils import configure_logging
from scripts.common.state_store import (
    StateStoreError,
    atomic_write_json,
    load_processing_state,
    read_json_object,
    utc_now,
)

SUPPORTED_STATUSES = {
    "pending",
    "audio_processing",
    "audio_ready",
    "layout_ready",
    "rendering",
    "video_ready",
    "uploading",
    "uploaded",
}


def _record(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


def _status(*values: Any) -> str:
    for value in values:
        status = _text(value)
        if status in SUPPORTED_STATUSES:
            return status
    return "pending"


def _youtube_fields(
    manifest: Mapping[str, Any], state_job: Mapping[str, Any]
) -> dict[str, str | None]:
    youtube = _record(manifest.get("youtube"))
    video_id = (
        _text(manifest.get("youtube_video_id"))
        or _text(youtube.get("video_id"))
        or _text(state_job.get("youtube_video_id"))
    )
    url = (
        _text(manifest.get("youtube_url"))
        or _text(youtube.get("url"))
        or _text(state_job.get("youtube_url"))
    )
    if url is None and video_id:
        url = f"https://www.youtube.com/watch?v={video_id}"
    privacy = (
        _text(manifest.get("privacy"))
        or _text(youtube.get("privacy"))
        or _text(state_job.get("privacy"))
    )
    return {"url": url, "video_id": video_id, "privacy": privacy}


def _manifest_for(
    output_root: Path, content_id: str
) -> Mapping[str, Any]:
    path = output_root / "jobs" / content_id / "manifest.json"
    return read_json_object(path, missing_ok=True)


def _snapshot_job(
    row: ValidatedRow,
    state_job: Mapping[str, Any],
    manifest: Mapping[str, Any],
) -> dict[str, Any]:
    source = _record(manifest.get("source"))
    durations = _record(manifest.get("durations_seconds"))
    youtube = _youtube_fields(manifest, state_job)
    return {
        "contentId": row.content_id,
        "sourceRow": row.source_row,
        "topic": _text(source.get("Topik")) or row.topic,
        "optionA": _text(source.get("Opsi A")) or row.option_a,
        "optionB": _text(source.get("Opsi B")) or row.option_b,
        "percentageA": _number(source.get("Persentase A")) or row.percentage_a,
        "percentageB": _number(source.get("Persentase B")) or row.percentage_b,
        "status": _status(manifest.get("status"), state_job.get("status")),
        "updatedAt": _text(manifest.get("updated_at"))
        or _text(state_job.get("updated_at")),
        "failedStep": _text(manifest.get("failed_step"))
        or _text(state_job.get("failed_step")),
        "errorMessage": _text(manifest.get("error_message"))
        or _text(state_job.get("error_message")),
        "voice": _text(manifest.get("voice")),
        "durations": {
            "optionA": _number(durations.get("option_a")),
            "optionB": _number(durations.get("option_b")),
        },
        "media": {
            "audioAUrl": None,
            "audioBUrl": None,
            "videoUrl": None,
            "youtubeUrl": youtube["url"],
            "youtubeVideoId": youtube["video_id"],
            "privacy": youtube["privacy"],
        },
    }


def build_dashboard_snapshot(
    *,
    csv_path: Path,
    state_path: Path,
    output_root: Path,
    target_path: Path,
    percentage_tolerance: float = 0.01,
) -> dict[str, Any]:
    """Build and atomically persist a secret-free dashboard snapshot."""
    rows = read_valid_rows(csv_path, percentage_tolerance)
    state = load_processing_state(state_path)
    state_jobs = _record(state.get("jobs"))
    jobs = []
    for row in rows:
        state_job = _record(state_jobs.get(row.content_id))
        manifest = _manifest_for(output_root, row.content_id)
        jobs.append(_snapshot_job(row, state_job, manifest))

    snapshot = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "source": "github-snapshot",
        "jobs": jobs,
    }
    atomic_write_json(target_path, snapshot)
    return snapshot


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export a sanitized status snapshot for the web dashboard."
    )
    parser.add_argument("--csv", type=Path, default=Path("data/data.csv"))
    parser.add_argument(
        "--state",
        type=Path,
        default=Path("state/processing_state.json"),
    )
    parser.add_argument("--output-root", type=Path, default=Path("output"))
    parser.add_argument(
        "--target",
        type=Path,
        default=Path("dashboard-data/jobs.json"),
    )
    parser.add_argument("--percentage-tolerance", type=float, default=0.01)
    parser.add_argument(
        "--log-file",
        type=Path,
        default=Path("logs/dashboard_export.log"),
    )
    parser.add_argument("--verbose", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logger: logging.Logger | None = None
    try:
        logger = configure_logging(args.log_file, args.verbose)
        snapshot = build_dashboard_snapshot(
            csv_path=args.csv,
            state_path=args.state,
            output_root=args.output_root,
            target_path=args.target,
            percentage_tolerance=args.percentage_tolerance,
        )
        logger.info(
            "Dashboard snapshot written to %s with %d job(s)",
            args.target,
            len(snapshot["jobs"]),
            extra={"step": "dashboard_export"},
        )
        return 0
    except (
        CSVInputError,
        RowValidationError,
        StateStoreError,
        OSError,
        RuntimeError,
    ) as exc:
        message = f"{type(exc).__name__}: {exc}".replace("\n", " ")[:500]
        if logger:
            logger.error(message, extra={"step": "dashboard_export"})
            logger.debug(
                "Detailed dashboard export failure",
                exc_info=True,
                extra={"step": "dashboard_export"},
            )
        else:
            print(f"ERROR: {message}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
