from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.common.csv_jobs import derive_content_id
from scripts.common.state_store import atomic_write_json
from scripts.export_dashboard import build_dashboard_snapshot


class DashboardExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.csv_path = self.root / "data.csv"
        self.state_path = self.root / "state.json"
        self.output_root = self.root / "output"
        self.target_path = self.root / "dashboard-data" / "jobs.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_csv(self) -> str:
        content_id = derive_content_id("Space or ocean?", "Space", "Ocean")
        with self.csv_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(
                [
                    "Topik",
                    "Opsi A",
                    "Opsi B",
                    "Persentase A",
                    "Persentase B",
                ]
            )
            writer.writerow(["Space or ocean?", "Space", "Ocean", "55", "45"])
        return content_id

    def test_snapshot_is_sanitized_and_contains_pipeline_status(self) -> None:
        content_id = self.write_csv()
        atomic_write_json(
            self.state_path,
            {
                "schema_version": 1,
                "jobs": {
                    content_id: {
                        "status": "video_ready",
                        "updated_at": "2026-07-26T10:00:00Z",
                        "access_token": "must-never-leak",
                    }
                },
            },
        )
        manifest_path = (
            self.output_root / "jobs" / content_id / "manifest.json"
        )
        atomic_write_json(
            manifest_path,
            {
                "content_id": content_id,
                "status": "video_ready",
                "source": {
                    "Topik": "Space or ocean?",
                    "Opsi A": "Space",
                    "Opsi B": "Ocean",
                    "Persentase A": 55,
                    "Persentase B": 45,
                },
                "credentials": {"client_secret": "must-never-leak"},
                "voice": "en-US-AriaNeural",
            },
        )

        snapshot = build_dashboard_snapshot(
            csv_path=self.csv_path,
            state_path=self.state_path,
            output_root=self.output_root,
            target_path=self.target_path,
        )

        self.assertEqual(snapshot["jobs"][0]["status"], "video_ready")
        self.assertEqual(snapshot["jobs"][0]["topic"], "Space or ocean?")
        serialized = self.target_path.read_text(encoding="utf-8")
        self.assertNotIn("must-never-leak", serialized)
        self.assertNotIn(str(self.root), serialized)
        self.assertIsNone(snapshot["jobs"][0]["media"]["videoUrl"])

    def test_missing_state_exports_pending_csv_rows(self) -> None:
        self.write_csv()
        snapshot = build_dashboard_snapshot(
            csv_path=self.csv_path,
            state_path=self.state_path,
            output_root=self.output_root,
            target_path=self.target_path,
        )
        self.assertEqual(snapshot["jobs"][0]["status"], "pending")
        parsed = json.loads(self.target_path.read_text(encoding="utf-8"))
        self.assertEqual(parsed["source"], "github-snapshot")


if __name__ == "__main__":
    unittest.main()
