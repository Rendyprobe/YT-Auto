"""CSV validation, normalization, content identity, and pending-row selection."""

from __future__ import annotations

import csv
import hashlib
import math
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from scripts.common.state_store import StateStoreError

REQUIRED_COLUMNS = (
    "Topik",
    "Opsi A",
    "Opsi B",
    "Persentase A",
    "Persentase B",
)
SUCCESS_AFTER_AUDIO = {
    "audio_ready",
    "layout_ready",
    "rendering",
    "video_ready",
    "uploading",
    "uploaded",
}


class CSVInputError(ValueError):
    """Raised for unreadable or structurally invalid CSV input."""


class RowValidationError(ValueError):
    """Raised when a source row fails validation."""


@dataclass(frozen=True)
class ValidatedRow:
    source_row: int
    topic: str
    option_a: str
    option_b: str
    percentage_a: float
    percentage_b: float

    @property
    def content_id(self) -> str:
        return derive_content_id(self.topic, self.option_a, self.option_b)

    def as_source_dict(self) -> dict[str, str | int | float]:
        return {
            "Topik": self.topic,
            "Opsi A": self.option_a,
            "Opsi B": self.option_b,
            "Persentase A": _compact_number(self.percentage_a),
            "Persentase B": _compact_number(self.percentage_b),
        }


def _compact_number(value: float) -> int | float:
    return int(value) if value.is_integer() else value


def normalize_text(value: Any, field_name: str) -> str:
    if value is None:
        raise RowValidationError(f"{field_name} must not be empty")
    normalized = unicodedata.normalize("NFKC", str(value))
    normalized = " ".join(normalized.split())
    if not normalized:
        raise RowValidationError(f"{field_name} must not be empty")
    return normalized


def _parse_percentage(value: Any, field_name: str) -> float:
    text = normalize_text(value, field_name)
    try:
        number = float(text)
    except ValueError as exc:
        raise RowValidationError(
            f"{field_name} must be a number from 0 to 100; received {text!r}"
        ) from exc
    if not math.isfinite(number) or not 0 <= number <= 100:
        raise RowValidationError(
            f"{field_name} must be a finite number from 0 to 100; received {text!r}"
        )
    return number


def validate_row(
    raw_row: Mapping[str, Any],
    source_row: int,
    percentage_tolerance: float = 0.01,
) -> ValidatedRow:
    if percentage_tolerance < 0:
        raise RowValidationError("Percentage tolerance must be zero or greater")
    try:
        row = ValidatedRow(
            source_row=source_row,
            topic=normalize_text(raw_row.get("Topik"), "Topik"),
            option_a=normalize_text(raw_row.get("Opsi A"), "Opsi A"),
            option_b=normalize_text(raw_row.get("Opsi B"), "Opsi B"),
            percentage_a=_parse_percentage(
                raw_row.get("Persentase A"), "Persentase A"
            ),
            percentage_b=_parse_percentage(
                raw_row.get("Persentase B"), "Persentase B"
            ),
        )
    except RowValidationError as exc:
        raise RowValidationError(f"CSV row {source_row}: {exc}") from exc

    total = row.percentage_a + row.percentage_b
    if abs(total - 100.0) > percentage_tolerance:
        raise RowValidationError(
            f"CSV row {source_row}: percentages total {total:g}; expected 100 "
            f"within tolerance {percentage_tolerance:g}"
        )
    return row


def derive_content_id(topic: str, option_a: str, option_b: str) -> str:
    normalized_values = (
        normalize_text(topic, "Topik"),
        normalize_text(option_a, "Opsi A"),
        normalize_text(option_b, "Opsi B"),
    )
    payload = "\x1f".join(normalized_values).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()[:12]


def read_valid_rows(
    csv_path: Path, percentage_tolerance: float = 0.01
) -> list[ValidatedRow]:
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None:
                raise CSVInputError(f"CSV has no header row: {csv_path}")
            missing = [name for name in REQUIRED_COLUMNS if name not in reader.fieldnames]
            if missing:
                raise CSVInputError(
                    "CSV is missing required column(s): " + ", ".join(missing)
                )

            rows: list[ValidatedRow] = []
            for source_row, raw_row in enumerate(reader, start=2):
                if not any(
                    str(raw_row.get(column) or "").strip()
                    for column in REQUIRED_COLUMNS
                ):
                    continue
                rows.append(validate_row(raw_row, source_row, percentage_tolerance))
    except CSVInputError:
        raise
    except UnicodeDecodeError as exc:
        raise CSVInputError(f"CSV must be UTF-8 encoded: {csv_path}") from exc
    except csv.Error as exc:
        raise CSVInputError(f"Unable to parse CSV {csv_path}: {exc}") from exc
    except OSError as exc:
        raise CSVInputError(f"Unable to read CSV {csv_path}: {exc}") from exc

    if not rows:
        raise CSVInputError(f"CSV contains no non-empty data rows: {csv_path}")
    return rows


def select_pending_row(
    csv_path: Path,
    state: Mapping[str, Any],
    percentage_tolerance: float = 0.01,
) -> ValidatedRow | None:
    jobs = state.get("jobs", {})
    if not isinstance(jobs, Mapping):
        raise StateStoreError("Processing state has an invalid 'jobs' object")
    for row in read_valid_rows(csv_path, percentage_tolerance):
        job = jobs.get(row.content_id, {})
        status = job.get("status") if isinstance(job, Mapping) else None
        if status not in SUCCESS_AFTER_AUDIO:
            return row
    return None
