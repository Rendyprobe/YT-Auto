from __future__ import annotations

import asyncio
import csv
import json
import logging
import tempfile
import unittest
from pathlib import Path

from scripts.common.state_store import atomic_write_json, load_processing_state
from scripts.data_audio import (
    CSVInputError,
    RowValidationError,
    TTSGenerationError,
    derive_content_id,
    read_valid_rows,
    run_data_audio,
    select_pending_row,
)


HEADER = ["Topik", "Opsi A", "Opsi B", "Persentase A", "Persentase B"]


class FakeCommunicate:
    calls: list[tuple[str, str]] = []

    def __init__(self, text: str, voice: str) -> None:
        self.text = text
        self.voice = voice
        self.calls.append((text, voice))

    async def save(self, path: str) -> None:
        Path(path).write_bytes(b"ID3" + self.text.encode("utf-8"))


class FailingCommunicate:
    calls = 0

    def __init__(self, text: str, voice: str) -> None:
        self.text = text
        self.voice = voice

    async def save(self, path: str) -> None:
        type(self).calls += 1
        raise ConnectionError("temporary test outage")


class FlakyCommunicate:
    calls = 0

    def __init__(self, text: str, voice: str) -> None:
        self.text = text
        self.voice = voice

    async def save(self, path: str) -> None:
        type(self).calls += 1
        if type(self).calls == 1:
            raise ConnectionError("temporary test outage")
        Path(path).write_bytes(b"ID3" + self.text.encode("utf-8"))


def make_logger() -> logging.Logger:
    logger = logging.getLogger(f"test_data_audio_{id(object())}")
    logger.handlers.clear()
    logger.addHandler(logging.NullHandler())
    logger.setLevel(logging.DEBUG)
    return logger


class DataAudioTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.csv_path = self.root / "data" / "data.csv"
        self.state_path = self.root / "state" / "processing_state.json"
        self.output_root = self.root / "output"
        self.csv_path.parent.mkdir(parents=True)
        FakeCommunicate.calls = []
        FailingCommunicate.calls = 0
        FlakyCommunicate.calls = 0

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_csv(self, rows: list[list[object]], header: list[str] | None = None) -> None:
        with self.csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(header or HEADER)
            writer.writerows(rows)

    def run_workflow(self, factory=FakeCommunicate):
        return asyncio.run(
            run_data_audio(
                csv_path=self.csv_path,
                state_path=self.state_path,
                output_root=self.output_root,
                voice="en-US-AriaNeural",
                percentage_tolerance=0.01,
                timeout_seconds=1.0,
                max_retries=0,
                backoff_initial_seconds=0,
                logger=make_logger(),
                project_root=self.root,
                communicate_factory=factory,
            )
        )

    def test_valid_csv_generates_two_audio_files_manifest_and_state(self) -> None:
        self.write_csv(
            [["Space or ocean?", "Explore space", "Explore ocean", "58", "42"]]
        )

        result = self.run_workflow()

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result.option_a_path.stat().st_size > 0)
        self.assertTrue(result.option_b_path.stat().st_size > 0)
        manifest = json.loads(result.manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["status"], "audio_ready")
        self.assertEqual(manifest["source"]["Persentase A"], 58)
        self.assertEqual(
            manifest["artifacts"]["audio"]["option_a"],
            f"output/audio/{result.content_id}/option_a.mp3",
        )
        state = load_processing_state(self.state_path)
        self.assertEqual(state["jobs"][result.content_id]["status"], "audio_ready")
        self.assertEqual(len(FakeCommunicate.calls), 2)

    def test_missing_required_column_fails(self) -> None:
        self.write_csv(
            [["Question", "A", "B", "100"]],
            header=["Topik", "Opsi A", "Opsi B", "Persentase A"],
        )

        with self.assertRaisesRegex(CSVInputError, "Persentase B"):
            read_valid_rows(self.csv_path)

    def test_invalid_percentage_range_and_sum_fail(self) -> None:
        self.write_csv([["Question", "A", "B", "101", "-1"]])
        with self.assertRaisesRegex(RowValidationError, "0 to 100"):
            read_valid_rows(self.csv_path)

        self.write_csv([["Question", "A", "B", "60", "30"]])
        with self.assertRaisesRegex(RowValidationError, "expected 100"):
            read_valid_rows(self.csv_path)

    def test_selects_first_pending_row_and_skips_completed_content(self) -> None:
        rows = [
            ["First?", "A1", "B1", "50", "50"],
            ["Second?", "A2", "B2", "25", "75"],
        ]
        self.write_csv(rows)
        first_id = derive_content_id("First?", "A1", "B1")
        state = {
            "schema_version": 1,
            "jobs": {first_id: {"status": "audio_ready"}},
        }

        selected = select_pending_row(self.csv_path, state)

        self.assertIsNotNone(selected)
        assert selected is not None
        self.assertEqual(selected.topic, "Second?")

    def test_content_id_is_stable_after_conservative_normalization(self) -> None:
        first = derive_content_id("A  question", " Option A ", "Option B")
        second = derive_content_id("A\t question", "Option A", "Option B")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 12)

    def test_tts_failure_records_failure_without_false_success(self) -> None:
        self.write_csv([["Question?", "A", "B", "50", "50"]])

        with self.assertRaises(TTSGenerationError):
            self.run_workflow(factory=FailingCommunicate)

        content_id = derive_content_id("Question?", "A", "B")
        state = load_processing_state(self.state_path)
        job = state["jobs"][content_id]
        self.assertEqual(job["status"], "audio_processing")
        self.assertEqual(job["failed_step"], "audio_processing")
        self.assertNotEqual(job["status"], "audio_ready")
        manifest_path = self.output_root / "jobs" / content_id / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["failed_step"], "audio_processing")
        self.assertFalse(
            (self.output_root / "audio" / content_id / "option_a.mp3").exists()
        )

    def test_transient_tts_error_is_retried(self) -> None:
        self.write_csv([["Question?", "A", "B", "50", "50"]])

        result = asyncio.run(
            run_data_audio(
                csv_path=self.csv_path,
                state_path=self.state_path,
                output_root=self.output_root,
                voice="en-US-AriaNeural",
                percentage_tolerance=0.01,
                timeout_seconds=1.0,
                max_retries=1,
                backoff_initial_seconds=0,
                logger=make_logger(),
                project_root=self.root,
                communicate_factory=FlakyCommunicate,
            )
        )

        self.assertIsNotNone(result)
        self.assertEqual(FlakyCommunicate.calls, 3)

    def test_successful_rerun_is_idempotent(self) -> None:
        self.write_csv([["Question?", "A", "B", "50", "50"]])
        first = self.run_workflow()
        call_count = len(FakeCommunicate.calls)

        second = self.run_workflow()

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertEqual(len(FakeCommunicate.calls), call_count)

    def test_empty_required_value_fails(self) -> None:
        self.write_csv([["Question?", "", "B", "50", "50"]])
        with self.assertRaisesRegex(RowValidationError, "Opsi A must not be empty"):
            read_valid_rows(self.csv_path)

    def test_blank_rows_are_ignored(self) -> None:
        self.write_csv(
            [
                ["", "", "", "", ""],
                ["Question?", "A", "B", "40", "60"],
            ]
        )
        rows = read_valid_rows(self.csv_path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].source_row, 3)


if __name__ == "__main__":
    unittest.main()
