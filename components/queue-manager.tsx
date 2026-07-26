"use client";

import { useEffect, useMemo, useState } from "react";

import { DashboardJob } from "@/lib/dashboard-types";
import type { QueueData, QueueRow } from "@/lib/queue-store";

type EditableRow = QueueRow & { editorId: string };

function editable(rows: QueueRow[]): EditableRow[] {
  return rows.map((row, index) => ({
    ...row,
    editorId: `${row.contentId}-${index}`,
  }));
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(rows: EditableRow[]) {
  const lines = [
    "Topik,Opsi A,Opsi B,Persentase A,Persentase B",
    ...rows.map((row) =>
      [
        row.topic,
        row.optionA,
        row.optionB,
        row.percentageA,
        row.percentageB,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "data.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function validationMessage(rows: EditableRow[]) {
  if (!rows.length) return "Minimal harus ada satu pertanyaan.";
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row.topic.trim() || !row.optionA.trim() || !row.optionB.trim()) {
      return `Baris ${index + 1}: pertanyaan dan kedua opsi wajib diisi.`;
    }
    if (
      !Number.isFinite(row.percentageA) ||
      !Number.isFinite(row.percentageB) ||
      row.percentageA < 0 ||
      row.percentageA > 100 ||
      row.percentageB < 0 ||
      row.percentageB > 100
    ) {
      return `Baris ${index + 1}: persentase harus antara 0–100.`;
    }
    if (Math.abs(row.percentageA + row.percentageB - 100) > 0.01) {
      return `Baris ${index + 1}: total persentase harus 100.`;
    }
  }
  return null;
}

export function QueueManager({
  initialQueue,
  jobs,
  onSaved,
}: {
  initialQueue: QueueData | null;
  jobs: DashboardJob[];
  onSaved: () => void;
}) {
  const [queue, setQueue] = useState<QueueData | null>(initialQueue);
  const [rows, setRows] = useState<EditableRow[]>(
    initialQueue ? editable(initialQueue.rows) : [],
  );
  const [loading, setLoading] = useState(!initialQueue);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/queue", { cache: "no-store" });
      const body = (await response.json()) as QueueData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Queue gagal dimuat.");
      setQueue(body);
      setRows(editable(body.rows));
      setDirty(false);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Queue gagal dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialQueue) void load();
  }, []);

  const validation = useMemo(() => validationMessage(rows), [rows]);
  const statuses = useMemo(
    () => new Map(jobs.map((job) => [job.contentId, job.status])),
    [jobs],
  );

  function updateRow(
    editorId: string,
    field: keyof QueueRow,
    value: string | number,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.editorId === editorId ? { ...row, [field]: value } : row,
      ),
    );
    setDirty(true);
    setMessage(null);
  }

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        editorId: `new-${Date.now()}`,
        contentId: "",
        topic: "",
        optionA: "",
        optionB: "",
        percentageA: 50,
        percentageB: 50,
      },
    ]);
    setDirty(true);
    setMessage(null);
  }

  async function save() {
    if (!queue?.canEdit || validation) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/queue", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = (await response.json()) as QueueData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Queue gagal disimpan.");
      setQueue(body);
      setRows(editable(body.rows));
      setDirty(false);
      setMessage("Perubahan tersimpan. Urutan CSV sudah diperbarui.");
      onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Queue gagal disimpan.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <section className="control-panel empty-list">Loading queue…</section>;
  }

  return (
    <section className="control-panel queue-editor">
      <div className="control-heading">
        <div>
          <p className="eyebrow">CSV CONTROL</p>
          <h2>Queue editor</h2>
          <p>
            Urutan di bawah adalah urutan video yang akan diproses. Gunakan
            tombol ↑ dan ↓ untuk memindahkan pertanyaan.
          </p>
        </div>
        <div className="queue-capability">
          <span className={queue?.canEdit ? "capability-on" : "capability-off"}>
            {queue?.canEdit ? "EDITING ENABLED" : "READ ONLY"}
          </span>
          <small>
            {queue?.backend === "local"
              ? "Saving directly to data/data.csv"
              : queue?.backend === "github"
                ? "Saving through GitHub"
                : "GitHub token is not connected"}
          </small>
        </div>
      </div>

      {!queue?.canEdit && (
        <div className="control-notice">
          Versi online belum diberi izin menulis ke GitHub. Kamu tetap bisa
          mengatur queue dan mengunduh CSV; untuk menyimpan langsung, jalankan
          web lokal atau pasang token server-side.
        </div>
      )}
      <div className="identity-note">
        Mengubah Topik atau Opsi membuat <code>content_id</code> baru. Hasil
        lama tidak dihapus otomatis, sehingga tidak ada video yang hilang.
      </div>
      {error && <div className="error-card">{error}</div>}
      {message && <div className="success-card">{message}</div>}

      <div className="queue-actions">
        <button className="secondary-action" type="button" onClick={addRow}>
          + Tambah pertanyaan
        </button>
        <button
          className="secondary-action"
          type="button"
          onClick={() => downloadCsv(rows)}
        >
          Download CSV ↓
        </button>
        <span>{dirty ? "Ada perubahan belum disimpan" : "Semua tersimpan"}</span>
        <button
          className="primary-action"
          type="button"
          disabled={!queue?.canEdit || !dirty || Boolean(validation) || saving}
          onClick={() => void save()}
        >
          {saving ? "Menyimpan…" : "Simpan urutan"}
        </button>
      </div>
      {validation && <div className="inline-validation">{validation}</div>}

      <div className="editor-list">
        {rows.map((row, index) => (
          <article className="editor-row" key={row.editorId}>
            <div className="order-control">
              <strong>{String(index + 1).padStart(2, "0")}</strong>
              <div>
                <button
                  type="button"
                  aria-label={`Move row ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move row ${index + 1} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>
            </div>
            <div className="editor-fields">
              <label className="topic-field">
                <span>PERTANYAAN / TOPIK</span>
                <input
                  value={row.topic}
                  onChange={(event) =>
                    updateRow(row.editorId, "topic", event.target.value)
                  }
                  placeholder="Would you rather…?"
                />
              </label>
              <label>
                <span>OPSI A</span>
                <input
                  value={row.optionA}
                  onChange={(event) =>
                    updateRow(row.editorId, "optionA", event.target.value)
                  }
                />
              </label>
              <label>
                <span>OPSI B</span>
                <input
                  value={row.optionB}
                  onChange={(event) =>
                    updateRow(row.editorId, "optionB", event.target.value)
                  }
                />
              </label>
              <label className="percentage-field">
                <span>% A</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.percentageA}
                  onChange={(event) =>
                    updateRow(
                      row.editorId,
                      "percentageA",
                      event.target.valueAsNumber,
                    )
                  }
                />
              </label>
              <label className="percentage-field">
                <span>% B</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.percentageB}
                  onChange={(event) =>
                    updateRow(
                      row.editorId,
                      "percentageB",
                      event.target.valueAsNumber,
                    )
                  }
                />
              </label>
            </div>
            <div className="editor-meta">
              <span>{statuses.get(row.contentId) ?? "new"}</span>
              <button
                type="button"
                onClick={() => {
                  setRows((current) =>
                    current.filter((item) => item.editorId !== row.editorId),
                  );
                  setDirty(true);
                }}
              >
                Hapus
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
