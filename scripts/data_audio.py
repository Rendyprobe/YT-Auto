"""Select one pending CSV row and create its English TTS audio assets."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from scripts.common.config import ConfigError, get_setting, load_settings
from scripts.common.csv_jobs import (
    CSVInputError,
    RowValidationError,
    ValidatedRow,
    derive_content_id,
    read_valid_rows,
    select_pending_row,
)
from scripts.common.logging_utils import configure_logging
from scripts.common.state_store import (
    StateStoreError,
    atomic_write_json,
    load_processing_state,
    read_json_object,
    update_job,
    utc_now,
)
from scripts.common.tts import (
    TTSGenerationError,
    is_valid_mp3,
    probe_audio_duration,
    synthesize_tts,
)


@dataclass(frozen=True)
class AudioResult:
    content_id: str
    manifest_path: Path
    option_a_path: Path
    option_b_path: Path


def _display_path(path: Path, project_root: Path) -> str:
    try:
        return path.resolve().relative_to(project_root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def _base_manifest(
    row: ValidatedRow,
    *,
    voice: str,
    option_a_path: Path,
    option_b_path: Path,
    project_root: Path,
    existing: Mapping[str, Any],
) -> dict[str, Any]:
    now = utc_now()
    return {
        "schema_version": 1,
        "content_id": row.content_id,
        "source_row": row.source_row,
        "source": row.as_source_dict(),
        "status": "audio_processing",
        "voice": voice,
        "artifacts": {
            "audio": {
                "option_a": _display_path(option_a_path, project_root),
                "option_b": _display_path(option_b_path, project_root),
            }
        },
        "durations_seconds": {"option_a": None, "option_b": None},
        "created_at": existing.get("created_at", now),
        "updated_at": now,
    }


def _concise_error(exc: BaseException, limit: int = 500) -> str:
    message = f"{type(exc).__name__}: {exc}".replace("\n", " ").strip()
    return message[:limit]


def _record_failure(
    *,
    state_path: Path,
    manifest_path: Path,
    content_id: str,
    error: BaseException,
    logger: logging.Logger,
) -> None:
    now = utc_now()
    error_message = _concise_error(error)
    try:
        manifest = read_json_object(manifest_path, missing_ok=True)
        if manifest:
            manifest.update(
                {
                    "failed_step": "audio_processing",
                    "error_message": error_message,
                    "updated_at": now,
                }
            )
            atomic_write_json(manifest_path, manifest)
    except StateStoreError:
        logger.debug(
            "Unable to record failure in manifest",
            exc_info=True,
            extra={"step": "failure_record", "content_id": content_id},
        )
    try:
        update_job(
            state_path,
            content_id,
            {
                "status": "audio_processing",
                "failed_step": "audio_processing",
                "error_message": error_message,
                "updated_at": now,
            },
        )
    except StateStoreError:
        logger.debug(
            "Unable to record failure in processing state",
            exc_info=True,
            extra={"step": "failure_record", "content_id": content_id},
        )


async def run_data_audio(
    *,
    csv_path: Path,
    state_path: Path,
    output_root: Path,
    voice: str,
    percentage_tolerance: float,
    timeout_seconds: float,
    max_retries: int,
    backoff_initial_seconds: float,
    logger: logging.Logger,
    project_root: Path | None = None,
    communicate_factory: Callable[[str, str], Any] | None = None,
    sleep: Callable[[float], Any] = asyncio.sleep,
) -> AudioResult | None:
    """Process exactly one pending row and return its finalized artifacts."""
    root = project_root or Path.cwd()
    state = load_processing_state(state_path)
    row = select_pending_row(csv_path, state, percentage_tolerance)
    if row is None:
        logger.info(
            "No pending CSV rows; all known rows already have audio-ready state",
            extra={"step": "selection"},
        )
        return None

    content_id = row.content_id
    context = {"content_id": content_id}
    audio_dir = output_root / "audio" / content_id
    option_a_path = audio_dir / "option_a.mp3"
    option_b_path = audio_dir / "option_b.mp3"
    manifest_path = output_root / "jobs" / content_id / "manifest.json"

    try:
        existing_manifest = read_json_object(manifest_path, missing_ok=True)
        reuse_existing_audio = existing_manifest.get("voice") == voice
        manifest = _base_manifest(
            row,
            voice=voice,
            option_a_path=option_a_path,
            option_b_path=option_b_path,
            project_root=root,
            existing=existing_manifest,
        )
        update_job(
            state_path,
            content_id,
            {
                "status": "audio_processing",
                "source_row": row.source_row,
                "updated_at": manifest["updated_at"],
            },
            remove_keys=("failed_step", "error_message"),
        )
        atomic_write_json(manifest_path, manifest)

        logger.info(
            "Processing CSV row %d with voice %s",
            row.source_row,
            voice,
            extra={**context, "step": "audio_processing"},
        )
        if not (reuse_existing_audio and is_valid_mp3(option_a_path)):
            await synthesize_tts(
                text=row.option_a,
                voice=voice,
                target_path=option_a_path,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
                backoff_initial_seconds=backoff_initial_seconds,
                logger=logger,
                communicate_factory=communicate_factory,
                sleep=sleep,
            )
        if not (reuse_existing_audio and is_valid_mp3(option_b_path)):
            await synthesize_tts(
                text=row.option_b,
                voice=voice,
                target_path=option_b_path,
                timeout_seconds=timeout_seconds,
                max_retries=max_retries,
                backoff_initial_seconds=backoff_initial_seconds,
                logger=logger,
                communicate_factory=communicate_factory,
                sleep=sleep,
            )
        if not (is_valid_mp3(option_a_path) and is_valid_mp3(option_b_path)):
            raise TTSGenerationError(
                "Both Option A and Option B audio files must be valid, non-empty MP3s"
            )

        manifest["durations_seconds"] = {
            "option_a": probe_audio_duration(option_a_path, logger),
            "option_b": probe_audio_duration(option_b_path, logger),
        }
        manifest["status"] = "audio_ready"
        manifest["updated_at"] = utc_now()
        manifest.pop("failed_step", None)
        manifest.pop("error_message", None)
        atomic_write_json(manifest_path, manifest)
        update_job(
            state_path,
            content_id,
            {
                "status": "audio_ready",
                "source_row": row.source_row,
                "manifest": _display_path(manifest_path, root),
                "artifacts": manifest["artifacts"],
                "updated_at": manifest["updated_at"],
            },
            remove_keys=("failed_step", "error_message"),
        )
    except (StateStoreError, TTSGenerationError, OSError) as exc:
        _record_failure(
            state_path=state_path,
            manifest_path=manifest_path,
            content_id=content_id,
            error=exc,
            logger=logger,
        )
        raise

    logger.info(
        "Audio is ready; manifest written to %s",
        manifest_path,
        extra={**context, "step": "audio_ready"},
    )
    return AudioResult(
        content_id=content_id,
        manifest_path=manifest_path,
        option_a_path=option_a_path,
        option_b_path=option_b_path,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Process one pending Would You Rather CSV row and generate English TTS."
        )
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/settings.json"),
        help=(
            "Local JSON settings file (default: config/settings.json; "
            "falls back to settings.example.json)"
        ),
    )
    parser.add_argument("--csv", type=Path, help="Source CSV path")
    parser.add_argument("--state", type=Path, help="Processing state JSON path")
    parser.add_argument("--output-root", type=Path, help="Generated output directory")
    parser.add_argument("--voice", help="edge-tts English voice name")
    parser.add_argument(
        "--percentage-tolerance",
        type=float,
        help="Allowed absolute error when percentages are summed",
    )
    parser.add_argument("--timeout", type=float, help="TTS request timeout in seconds")
    parser.add_argument("--retries", type=int, help="Retries after the first request")
    parser.add_argument(
        "--backoff",
        type=float,
        help="Initial retry backoff in seconds (doubles each retry)",
    )
    parser.add_argument("--log-file", type=Path, help="Detailed log file path")
    parser.add_argument(
        "--verbose", action="store_true", help="Show debug logging on the console"
    )
    return parser


def _configured_value(
    cli_value: Any,
    settings: Mapping[str, Any],
    section: str,
    key: str,
    expected_type: type | tuple[type, ...],
) -> Any:
    if cli_value is not None:
        return cli_value
    return get_setting(settings, section, key, expected_type)


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logger: logging.Logger | None = None
    try:
        settings = load_settings(args.config)
        log_path = Path(
            _configured_value(
                args.log_file, settings, "paths", "log_file", (str, Path)
            )
        )
        logger = configure_logging(log_path, args.verbose)
        asyncio.run(
            run_data_audio(
                csv_path=Path(
                    _configured_value(args.csv, settings, "paths", "csv", (str, Path))
                ),
                state_path=Path(
                    _configured_value(
                        args.state, settings, "paths", "state", (str, Path)
                    )
                ),
                output_root=Path(
                    _configured_value(
                        args.output_root,
                        settings,
                        "paths",
                        "output_root",
                        (str, Path),
                    )
                ),
                voice=str(
                    _configured_value(args.voice, settings, "audio", "voice", str)
                ),
                percentage_tolerance=float(
                    _configured_value(
                        args.percentage_tolerance,
                        settings,
                        "validation",
                        "percentage_sum_tolerance",
                        (int, float),
                    )
                ),
                timeout_seconds=float(
                    _configured_value(
                        args.timeout,
                        settings,
                        "audio",
                        "timeout_seconds",
                        (int, float),
                    )
                ),
                max_retries=int(
                    _configured_value(
                        args.retries, settings, "audio", "max_retries", int
                    )
                ),
                backoff_initial_seconds=float(
                    _configured_value(
                        args.backoff,
                        settings,
                        "audio",
                        "backoff_initial_seconds",
                        (int, float),
                    )
                ),
                logger=logger,
            )
        )
        return 0
    except KeyboardInterrupt:
        if logger:
            logger.warning("Interrupted by operator", extra={"step": "interrupted"})
        return 130
    except (
        ConfigError,
        CSVInputError,
        RowValidationError,
        StateStoreError,
        TTSGenerationError,
        RuntimeError,
        OSError,
    ) as exc:
        if logger:
            logger.error("%s", _concise_error(exc), extra={"step": "failed"})
            logger.debug(
                "Detailed failure", exc_info=True, extra={"step": "failed"}
            )
        else:
            print(f"ERROR: {_concise_error(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
