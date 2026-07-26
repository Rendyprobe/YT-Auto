"""Atomic JSON persistence for pipeline state and job manifests."""

from __future__ import annotations

import json
import os
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping


class StateStoreError(RuntimeError):
    """Raised when state or manifest persistence fails."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json_object(path: Path, *, missing_ok: bool = False) -> dict[str, Any]:
    if missing_ok and not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError as exc:
        raise StateStoreError(f"JSON file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise StateStoreError(
            f"Invalid JSON in {path} at line {exc.lineno}, column {exc.colno}"
        ) from exc
    except OSError as exc:
        raise StateStoreError(f"Unable to read JSON file {path}: {exc}") from exc

    if not isinstance(value, dict):
        raise StateStoreError(f"JSON root must be an object: {path}")
    return value


def atomic_write_json(path: Path, value: Mapping[str, Any]) -> None:
    """Write JSON to a same-directory temporary file and atomically replace."""
    temp_path: Path | None = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
        )
        temp_path = Path(temp_name)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except (OSError, TypeError, ValueError) as exc:
        raise StateStoreError(f"Unable to atomically write {path}: {exc}") from exc
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def load_processing_state(path: Path) -> dict[str, Any]:
    state = read_json_object(path, missing_ok=True)
    if not state:
        return {"schema_version": 1, "jobs": {}}
    jobs = state.get("jobs")
    if not isinstance(jobs, dict):
        raise StateStoreError(f"State file has an invalid 'jobs' object: {path}")
    state.setdefault("schema_version", 1)
    return state


def update_job(
    path: Path,
    content_id: str,
    changes: Mapping[str, Any],
    *,
    remove_keys: Iterable[str] = (),
) -> dict[str, Any]:
    state = load_processing_state(path)
    jobs = deepcopy(state["jobs"])
    existing = jobs.get(content_id, {})
    if not isinstance(existing, dict):
        raise StateStoreError(f"State job is invalid for content_id {content_id}")
    job = deepcopy(existing)
    for key in remove_keys:
        job.pop(key, None)
    job.update(deepcopy(dict(changes)))
    jobs[content_id] = job
    state["jobs"] = jobs
    atomic_write_json(path, state)
    return state
