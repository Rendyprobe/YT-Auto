"""Consistent console and file logging for command-line workflows."""

from __future__ import annotations

import logging
from pathlib import Path


class _ContextDefaults(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "step"):
            record.step = "-"
        if not hasattr(record, "content_id"):
            record.content_id = "-"
        return True


def configure_logging(log_path: Path, verbose: bool = False) -> logging.Logger:
    """Create a structured pipeline logger without duplicating handlers."""
    logger = logging.getLogger("faceless_wyr")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False
    logger.handlers.clear()

    context_filter = _ContextDefaults()
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s step=%(step)s "
        "content_id=%(content_id)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )

    console = logging.StreamHandler()
    console.setLevel(logging.DEBUG if verbose else logging.INFO)
    console.addFilter(context_filter)
    console.setFormatter(formatter)
    logger.addHandler(console)

    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_path, encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"Unable to open log file {log_path}: {exc}") from exc

    file_handler.setLevel(logging.DEBUG)
    file_handler.addFilter(context_filter)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    return logger
