"""Asynchronous edge-tts generation and safe audio inspection."""

from __future__ import annotations

import asyncio
import logging
import math
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Callable


class TTSGenerationError(RuntimeError):
    """Raised when a TTS artifact cannot be generated safely."""


def is_valid_mp3(path: Path) -> bool:
    try:
        if not path.is_file() or path.stat().st_size < 4:
            return False
        with path.open("rb") as handle:
            header = handle.read(3)
    except OSError:
        return False
    if header == b"ID3":
        return True
    return len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0


def _is_transient_tts_error(exc: BaseException) -> bool:
    if isinstance(
        exc,
        (asyncio.TimeoutError, TimeoutError, ConnectionError, OSError),
    ):
        return True
    name = type(exc).__name__.lower()
    message = str(exc).lower()
    markers = (
        "timeout",
        "temporar",
        "connection",
        "disconnect",
        "rate limit",
        "429",
        "502",
        "503",
        "504",
    )
    return any(marker in name or marker in message for marker in markers)


def _default_communicate_factory(text: str, voice: str) -> Any:
    try:
        import edge_tts
    except ImportError as exc:
        raise TTSGenerationError(
            "edge-tts is not installed. Run: python -m pip install -r requirements.txt"
        ) from exc
    return edge_tts.Communicate(text=text, voice=voice)


async def synthesize_tts(
    *,
    text: str,
    voice: str,
    target_path: Path,
    timeout_seconds: float,
    max_retries: int,
    backoff_initial_seconds: float,
    logger: logging.Logger,
    communicate_factory: Callable[[str, str], Any] | None = None,
    sleep: Callable[[float], Any] = asyncio.sleep,
) -> None:
    if timeout_seconds <= 0:
        raise TTSGenerationError("TTS timeout must be greater than zero")
    if max_retries < 0:
        raise TTSGenerationError("TTS retry count must be zero or greater")
    if backoff_initial_seconds < 0:
        raise TTSGenerationError("TTS backoff must be zero or greater")

    factory = communicate_factory or _default_communicate_factory
    try:
        target_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise TTSGenerationError(
            f"Unable to create audio directory {target_path.parent}: {exc}"
        ) from exc

    attempts = max_retries + 1
    for attempt in range(1, attempts + 1):
        temp_path = target_path.with_name(
            f".{target_path.name}.{uuid.uuid4().hex}.tmp"
        )
        try:
            communicator = factory(text, voice)
            await asyncio.wait_for(
                communicator.save(str(temp_path)), timeout=timeout_seconds
            )
            if not is_valid_mp3(temp_path):
                raise TTSGenerationError(
                    f"TTS returned an empty or invalid MP3 for {target_path.name}"
                )
            os.replace(temp_path, target_path)
            return
        except (asyncio.CancelledError, KeyboardInterrupt):
            raise
        except Exception as exc:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                logger.debug(
                    "Unable to remove temporary TTS file %s",
                    temp_path,
                    exc_info=True,
                    extra={"step": "audio_processing"},
                )
            if not _is_transient_tts_error(exc) or attempt >= attempts:
                if isinstance(exc, TTSGenerationError):
                    raise
                raise TTSGenerationError(
                    f"TTS failed for {target_path.name} after {attempt} "
                    f"attempt(s): {type(exc).__name__}: {exc}"
                ) from exc
            delay = backoff_initial_seconds * (2 ** (attempt - 1))
            logger.warning(
                "Transient TTS failure for %s (attempt %d/%d); retrying in %.2fs",
                target_path.name,
                attempt,
                attempts,
                delay,
                extra={"step": "audio_processing"},
            )
            await sleep(delay)


def probe_audio_duration(
    path: Path, logger: logging.Logger | None = None
) -> float | None:
    executable = shutil.which("ffprobe")
    if executable is None:
        if logger:
            logger.debug(
                "ffprobe is unavailable; audio duration will be recorded as null",
                extra={"step": "audio_probe"},
            )
        return None
    command = [
        executable,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        completed = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
            shell=False,
        )
        duration = float(completed.stdout.strip())
    except (
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        OSError,
        ValueError,
    ):
        if logger:
            logger.debug(
                "Unable to safely probe audio duration for %s",
                path,
                exc_info=True,
                extra={"step": "audio_probe"},
            )
        return None
    return duration if math.isfinite(duration) and duration > 0 else None
