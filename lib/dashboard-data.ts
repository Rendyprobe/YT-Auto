import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import bundledSnapshot from "@/dashboard-data/jobs.json";
import {
  DashboardData,
  DashboardJob,
  PIPELINE_STAGES,
  PipelineStatus,
} from "@/lib/dashboard-types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function validStatus(value: unknown): PipelineStatus {
  return PIPELINE_STAGES.includes(value as PipelineStatus)
    ? (value as PipelineStatus)
    : "pending";
}

function readJson(filePath: string): UnknownRecord {
  return asRecord(JSON.parse(readFileSync(filePath, "utf8")));
}

function safeYoutubeFields(manifest: UnknownRecord, stateJob: UnknownRecord) {
  const youtube = asRecord(manifest.youtube);
  const videoId =
    asString(manifest.youtube_video_id) ??
    asString(youtube.video_id) ??
    asString(stateJob.youtube_video_id);
  const url =
    asString(manifest.youtube_url) ??
    asString(youtube.url) ??
    asString(stateJob.youtube_url) ??
    (videoId ? `https://www.youtube.com/watch?v=${videoId}` : null);
  return {
    videoId,
    url,
    privacy:
      asString(manifest.privacy) ??
      asString(youtube.privacy) ??
      asString(stateJob.privacy),
  };
}

function overlayLiveJob(
  snapshotJob: DashboardJob,
  stateJob: UnknownRecord,
  root: string,
): DashboardJob {
  const manifestPath = path.join(
    root,
    "output",
    "jobs",
    snapshotJob.contentId,
    "manifest.json",
  );
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const source = asRecord(manifest.source);
  const durations = asRecord(manifest.durations_seconds);
  const youtube = safeYoutubeFields(manifest, stateJob);
  const audioDir = path.join(root, "output", "audio", snapshotJob.contentId);
  const videoPath = path.join(
    root,
    "output",
    "videos",
    `${snapshotJob.contentId}.mp4`,
  );

  return {
    ...snapshotJob,
    sourceRow:
      typeof manifest.source_row === "number"
        ? manifest.source_row
        : snapshotJob.sourceRow,
    topic: asString(source.Topik) ?? snapshotJob.topic,
    optionA: asString(source["Opsi A"]) ?? snapshotJob.optionA,
    optionB: asString(source["Opsi B"]) ?? snapshotJob.optionB,
    percentageA: asNumber(
      source["Persentase A"],
      snapshotJob.percentageA,
    ),
    percentageB: asNumber(
      source["Persentase B"],
      snapshotJob.percentageB,
    ),
    status: validStatus(manifest.status ?? stateJob.status),
    updatedAt:
      asString(manifest.updated_at) ??
      asString(stateJob.updated_at) ??
      snapshotJob.updatedAt,
    failedStep:
      asString(manifest.failed_step) ?? asString(stateJob.failed_step),
    errorMessage:
      asString(manifest.error_message) ?? asString(stateJob.error_message),
    voice: asString(manifest.voice) ?? snapshotJob.voice,
    durations: {
      optionA:
        typeof durations.option_a === "number" ? durations.option_a : null,
      optionB:
        typeof durations.option_b === "number" ? durations.option_b : null,
    },
    media: {
      audioAUrl: existsSync(path.join(audioDir, "option_a.mp3"))
        ? `/api/media/${snapshotJob.contentId}/option-a`
        : null,
      audioBUrl: existsSync(path.join(audioDir, "option_b.mp3"))
        ? `/api/media/${snapshotJob.contentId}/option-b`
        : null,
      videoUrl: existsSync(videoPath)
        ? `/api/media/${snapshotJob.contentId}/video`
        : null,
      youtubeUrl: youtube.url,
      youtubeVideoId: youtube.videoId,
      privacy: youtube.privacy,
    },
  };
}

export function getPipelineRoot(): string {
  return process.env.PIPELINE_ROOT
    ? path.resolve(process.env.PIPELINE_ROOT)
    : process.cwd();
}

export function loadDashboardData(): DashboardData {
  const snapshot = bundledSnapshot as DashboardData;
  const root = getPipelineRoot();
  const statePath = path.join(root, "state", "processing_state.json");
  if (!existsSync(statePath)) {
    return {
      ...snapshot,
      source: "bundled-snapshot",
    };
  }

  try {
    const state = readJson(statePath);
    const jobs = asRecord(state.jobs);
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: "local",
      jobs: snapshot.jobs.map((job) =>
        overlayLiveJob(job, asRecord(jobs[job.contentId]), root),
      ),
    };
  } catch (error) {
    console.error(
      "Unable to read local pipeline state; using bundled dashboard snapshot.",
      error instanceof Error ? error.message : "Unknown state error",
    );
    return {
      ...snapshot,
      source: "bundled-snapshot",
    };
  }
}
