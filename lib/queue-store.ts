import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { getPipelineRoot } from "@/lib/pipeline-root";

const REQUIRED_COLUMNS = [
  "Topik",
  "Opsi A",
  "Opsi B",
  "Persentase A",
  "Persentase B",
] as const;
const GITHUB_API_VERSION = "2026-03-10";
const DEFAULT_REPOSITORY = "Rendyprobe/YT-Auto";
const DEFAULT_BRANCH = "main";

export type QueueRow = {
  contentId: string;
  topic: string;
  optionA: string;
  optionB: string;
  percentageA: number;
  percentageB: number;
};

export type QueueBackend = "local" | "github" | "github-readonly";

export type QueueData = {
  rows: QueueRow[];
  backend: QueueBackend;
  canEdit: boolean;
  updatedAt: string;
};

export class QueueStoreError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
  ) {
    super(message);
    this.name = "QueueStoreError";
  }
}

function normalizeText(value: unknown, field: string, rowNumber: number): string {
  if (typeof value !== "string") {
    throw new QueueStoreError(`Row ${rowNumber}: ${field} must be text.`, 400);
  }
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new QueueStoreError(`Row ${rowNumber}: ${field} cannot be empty.`, 400);
  }
  return normalized;
}

function percentage(value: unknown, field: string, rowNumber: number): number {
  const number =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    throw new QueueStoreError(
      `Row ${rowNumber}: ${field} must be a number from 0 to 100.`,
      400,
    );
  }
  return number;
}

function deriveContentId(topic: string, optionA: string, optionB: string) {
  return createHash("sha256")
    .update([topic, optionA, optionB].join("\x1f"), "utf8")
    .digest("hex")
    .slice(0, 12);
}

export function validateQueueRows(input: unknown): QueueRow[] {
  if (!Array.isArray(input) || input.length < 1) {
    throw new QueueStoreError("Queue must contain at least one row.", 400);
  }
  if (input.length > 500) {
    throw new QueueStoreError("Queue is limited to 500 rows.", 400);
  }

  return input.map((value, index) => {
    const rowNumber = index + 2;
    const row =
      value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const topic = normalizeText(row.topic, "Topik", rowNumber);
    const optionA = normalizeText(row.optionA, "Opsi A", rowNumber);
    const optionB = normalizeText(row.optionB, "Opsi B", rowNumber);
    const percentageA = percentage(
      row.percentageA,
      "Persentase A",
      rowNumber,
    );
    const percentageB = percentage(
      row.percentageB,
      "Persentase B",
      rowNumber,
    );
    const total = percentageA + percentageB;
    if (Math.abs(total - 100) > 0.01) {
      throw new QueueStoreError(
        `Row ${rowNumber}: percentages total ${total}; expected 100.`,
        400,
      );
    }
    return {
      contentId: deriveContentId(topic, optionA, optionB),
      topic,
      optionA,
      optionB,
      percentageA,
      percentageB,
    };
  });
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.replace(/\r$/, ""));
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new QueueStoreError("CSV has an unclosed quote.", 400);
  record.push(field.replace(/\r$/, ""));
  if (record.some((value) => value.trim())) records.push(record);
  return records;
}

export function parseQueueCsv(csv: string): QueueRow[] {
  const records = parseCsvRecords(csv);
  if (!records.length) throw new QueueStoreError("CSV is empty.", 400);
  const header = records[0];
  const indexes = REQUIRED_COLUMNS.map((column) => header.indexOf(column));
  const missing = REQUIRED_COLUMNS.filter((_, index) => indexes[index] < 0);
  if (missing.length) {
    throw new QueueStoreError(
      `CSV is missing required column(s): ${missing.join(", ")}`,
      400,
    );
  }
  const rawRows = records.slice(1).map((record) => ({
    topic: record[indexes[0]] ?? "",
    optionA: record[indexes[1]] ?? "",
    optionB: record[indexes[2]] ?? "",
    percentageA: record[indexes[3]] ?? "",
    percentageB: record[indexes[4]] ?? "",
  }));
  return validateQueueRows(rawRows);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeQueueCsv(rows: QueueRow[]): string {
  const validated = validateQueueRows(rows);
  const lines = [
    REQUIRED_COLUMNS.join(","),
    ...validated.map((row) =>
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
  return `${lines.join("\r\n")}\r\n`;
}

export function localControlEnabled() {
  return (
    process.env.YT_AUTO_LOCAL_CONTROL === "1" ||
    process.env.NODE_ENV === "development"
  );
}

function localCsvPath() {
  return path.join(getPipelineRoot(), "data", "data.csv");
}

function githubConfig() {
  const repository =
    process.env.YT_AUTO_GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;
  const [owner, repo, ...extra] = repository.split("/");
  if (!owner || !repo || extra.length) {
    throw new QueueStoreError(
      "YT_AUTO_GITHUB_REPOSITORY must use OWNER/REPO format.",
      500,
    );
  }
  return {
    owner,
    repo,
    branch: process.env.YT_AUTO_GITHUB_BRANCH ?? DEFAULT_BRANCH,
    token: process.env.YT_AUTO_GITHUB_TOKEN,
  };
}

function githubHeaders(token?: string, raw = false): HeadersInit {
  return {
    Accept: raw
      ? "application/vnd.github.raw+json"
      : "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "User-Agent": "yt-auto-dashboard",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

function githubContentsUrl(owner: string, repo: string, branch: string) {
  const query = new URLSearchParams({ ref: branch });
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/data/data.csv?${query}`;
}

async function readGithubQueue(): Promise<QueueData> {
  const config = githubConfig();
  const response = await fetch(
    githubContentsUrl(config.owner, config.repo, config.branch),
    {
      headers: githubHeaders(config.token, true),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new QueueStoreError(
      `GitHub queue read failed with HTTP ${response.status}.`,
      502,
    );
  }
  return {
    rows: parseQueueCsv(await response.text()),
    backend: config.token ? "github" : "github-readonly",
    canEdit: Boolean(config.token),
    updatedAt: new Date().toISOString(),
  };
}

export function readLocalQueueSync(): QueueRow[] | null {
  const csvPath = localCsvPath();
  if (!existsSync(csvPath)) return null;
  return parseQueueCsv(readFileSync(csvPath, "utf8"));
}

async function readLocalQueue(): Promise<QueueData> {
  return {
    rows: parseQueueCsv(await readFile(localCsvPath(), "utf8")),
    backend: "local",
    canEdit: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadQueue(): Promise<QueueData> {
  if (localControlEnabled() && existsSync(localCsvPath())) {
    return readLocalQueue();
  }
  return readGithubQueue();
}

async function atomicWriteLocalCsv(csv: string) {
  const target = localCsvPath();
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  await mkdir(path.dirname(target), { recursive: true });
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(csv, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw new QueueStoreError(
      `Unable to save local CSV: ${
        error instanceof Error ? error.message : "unknown file error"
      }`,
      500,
    );
  }
}

async function writeGithubQueue(csv: string) {
  const config = githubConfig();
  if (!config.token) {
    throw new QueueStoreError(
      "Online editing is locked until YT_AUTO_GITHUB_TOKEN is configured.",
      403,
    );
  }
  const url = githubContentsUrl(config.owner, config.repo, config.branch);
  const current = await fetch(url, {
    headers: githubHeaders(config.token),
    cache: "no-store",
  });
  if (!current.ok) {
    throw new QueueStoreError(
      `GitHub could not load the current CSV (HTTP ${current.status}).`,
      502,
    );
  }
  const metadata = (await current.json()) as { sha?: unknown };
  if (typeof metadata.sha !== "string") {
    throw new QueueStoreError("GitHub CSV response did not include a SHA.", 502);
  }
  const saved = await fetch(url, {
    method: "PUT",
    headers: {
      ...githubHeaders(config.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "chore: update video queue from dashboard",
      content: Buffer.from(csv, "utf8").toString("base64"),
      sha: metadata.sha,
      branch: config.branch,
    }),
  });
  if (!saved.ok) {
    throw new QueueStoreError(
      `GitHub queue save failed with HTTP ${saved.status}.`,
      saved.status === 409 ? 409 : 502,
    );
  }
}

export async function saveQueue(input: unknown): Promise<QueueData> {
  const rows = validateQueueRows(input);
  const csv = serializeQueueCsv(rows);
  if (localControlEnabled() && existsSync(localCsvPath())) {
    await atomicWriteLocalCsv(csv);
    return readLocalQueue();
  }
  await writeGithubQueue(csv);
  return readGithubQueue();
}
