"""Configuration loading with safe example defaults."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping


class ConfigError(ValueError):
    """Raised when configuration cannot be loaded or validated."""


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError as exc:
        raise ConfigError(f"Configuration file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(
            f"Configuration is not valid JSON: {path} "
            f"(line {exc.lineno}, column {exc.colno})"
        ) from exc
    except OSError as exc:
        raise ConfigError(f"Unable to read configuration {path}: {exc}") from exc

    if not isinstance(value, dict):
        raise ConfigError(f"Configuration root must be a JSON object: {path}")
    return value


def _deep_merge(
    base: Mapping[str, Any], overrides: Mapping[str, Any]
) -> dict[str, Any]:
    merged = deepcopy(dict(base))
    for key, value in overrides.items():
        if isinstance(value, Mapping) and isinstance(merged.get(key), Mapping):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def load_settings(
    settings_path: Path,
    example_path: Path = Path("config/settings.example.json"),
) -> dict[str, Any]:
    """Load example defaults and merge an optional local settings file."""
    defaults = _read_json_object(example_path)
    if not settings_path.exists():
        return defaults
    return _deep_merge(defaults, _read_json_object(settings_path))


def get_setting(
    settings: Mapping[str, Any],
    section: str,
    key: str,
    expected_type: type | tuple[type, ...],
) -> Any:
    """Return a required typed setting with a useful validation error."""
    section_value = settings.get(section)
    if not isinstance(section_value, Mapping):
        raise ConfigError(f"Missing or invalid configuration section: {section}")
    value = section_value.get(key)
    if isinstance(value, bool) and expected_type is not bool:
        raise ConfigError(f"Invalid configuration value: {section}.{key}")
    if not isinstance(value, expected_type):
        raise ConfigError(f"Missing or invalid configuration value: {section}.{key}")
    return value
