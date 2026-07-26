export const PIPELINE_STAGES = [
  "pending",
  "audio_processing",
  "audio_ready",
  "layout_ready",
  "rendering",
  "video_ready",
  "uploading",
  "uploaded",
] as const;

export type PipelineStatus = (typeof PIPELINE_STAGES)[number];

export type DashboardJob = {
  contentId: string;
  sourceRow: number | null;
  topic: string;
  optionA: string;
  optionB: string;
  percentageA: number;
  percentageB: number;
  status: PipelineStatus;
  updatedAt: string | null;
  failedStep: string | null;
  errorMessage: string | null;
  voice: string | null;
  durations: {
    optionA: number | null;
    optionB: number | null;
  };
  media: {
    audioAUrl: string | null;
    audioBUrl: string | null;
    videoUrl: string | null;
    youtubeUrl: string | null;
    youtubeVideoId: string | null;
    privacy: string | null;
  };
};

export type DashboardData = {
  schemaVersion: number;
  generatedAt: string;
  source: "local" | "github-snapshot" | "bundled-snapshot";
  jobs: DashboardJob[];
};
