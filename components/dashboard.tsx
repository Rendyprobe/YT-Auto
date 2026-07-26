"use client";

import { useEffect, useMemo, useState } from "react";

import {
  DashboardData,
  DashboardJob,
  PIPELINE_STAGES,
  PipelineStatus,
} from "@/lib/dashboard-types";

const REMOTE_SNAPSHOT =
  "https://raw.githubusercontent.com/Rendyprobe/YT-Auto/main/dashboard-data/jobs.json";

const STATUS_LABELS: Record<PipelineStatus, string> = {
  pending: "Pending",
  audio_processing: "Making audio",
  audio_ready: "Audio ready",
  layout_ready: "Layout ready",
  rendering: "Rendering",
  video_ready: "Video ready",
  uploading: "Uploading",
  uploaded: "Uploaded",
};

const FINISHED_STATUSES = new Set<PipelineStatus>([
  "audio_ready",
  "layout_ready",
  "video_ready",
  "uploaded",
]);

function formatDate(value: string | null) {
  if (!value) return "Not started";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(parsed);
}

function formatDuration(value: number | null) {
  return value === null ? "—" : `${value.toFixed(2)}s`;
}

function statusIndex(status: PipelineStatus) {
  return PIPELINE_STAGES.indexOf(status);
}

function youtubeEmbed(job: DashboardJob) {
  return job.media.youtubeVideoId
    ? `https://www.youtube-nocookie.com/embed/${job.media.youtubeVideoId}`
    : null;
}

function MediaPanel({ job }: { job: DashboardJob }) {
  const embedUrl = youtubeEmbed(job);
  return (
    <section className="media-panel" aria-label="Video preview">
      <div className="media-toolbar">
        <span>9:16 PREVIEW</span>
        <span className="media-resolution">1080 × 1920 / 30 FPS</span>
      </div>
      <div className="phone-frame">
        {job.media.videoUrl ? (
          <video
            key={job.media.videoUrl}
            controls
            playsInline
            preload="metadata"
            src={job.media.videoUrl}
          />
        ) : embedUrl && job.media.privacy !== "private" ? (
          <iframe
            title={`YouTube preview for ${job.topic}`}
            src={embedUrl}
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="preview-placeholder">
            <div className="preview-top">
              <span>WOULD YOU RATHER?</span>
              <strong>{job.optionA}</strong>
              <b>{job.percentageA}%</b>
            </div>
            <div className="preview-divider">
              <span>{statusIndex(job.status) >= 4 ? "5" : "···"}</span>
            </div>
            <div className="preview-bottom">
              <b>{job.percentageB}%</b>
              <strong>{job.optionB}</strong>
              <small>VIDEO APPEARS AFTER RENDER</small>
            </div>
          </div>
        )}
      </div>
      <div className="media-actions">
        {job.media.youtubeUrl ? (
          <a href={job.media.youtubeUrl} target="_blank" rel="noreferrer">
            Open on YouTube ↗
          </a>
        ) : (
          <span>No YouTube upload yet</span>
        )}
        {job.media.privacy && (
          <span className="privacy-badge">{job.media.privacy}</span>
        )}
      </div>
    </section>
  );
}

function JobTimeline({ job }: { job: DashboardJob }) {
  const current = statusIndex(job.status);
  return (
    <ol className="timeline" aria-label="Pipeline progress">
      {PIPELINE_STAGES.map((stage, index) => {
        const complete = index < current || FINISHED_STATUSES.has(stage) && index === current;
        const active = index === current;
        return (
          <li
            key={stage}
            className={`${complete ? "complete" : ""} ${active ? "active" : ""}`}
          >
            <span className="timeline-dot">{complete ? "✓" : index + 1}</span>
            <div>
              <strong>{STATUS_LABELS[stage]}</strong>
              <small>
                {active ? "Current stage" : complete ? "Complete" : "Waiting"}
              </small>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function JobCard({
  job,
  selected,
  onSelect,
}: {
  job: DashboardJob;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`job-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <div className="job-card-topline">
        <span className={`status-pill status-${job.status}`}>
          {STATUS_LABELS[job.status]}
        </span>
        <code>{job.contentId}</code>
      </div>
      <h3>{job.topic}</h3>
      <div className="option-summary">
        <span>
          <i>A</i>
          {job.optionA}
          <b>{job.percentageA}%</b>
        </span>
        <span>
          <i>B</i>
          {job.optionB}
          <b>{job.percentageB}%</b>
        </span>
      </div>
      <div className="job-card-footer">
        <span>ROW {job.sourceRow ?? "—"}</span>
        <span>{formatDate(job.updatedAt)}</span>
      </div>
    </button>
  );
}

export function Dashboard({ initialData }: { initialData: DashboardData }) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(
    initialData.jobs[0]?.contentId ?? "",
  );
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function refresh() {
    setRefreshing(true);
    try {
      const localResponse = await fetch("/api/jobs", { cache: "no-store" });
      const localData = (await localResponse.json()) as DashboardData;
      if (localData.source === "local") {
        setData(localData);
      } else {
        const remoteResponse = await fetch(`${REMOTE_SNAPSHOT}?t=${Date.now()}`, {
          cache: "no-store",
        });
        setData(
          remoteResponse.ok
            ? ((await remoteResponse.json()) as DashboardData)
            : localData,
        );
      }
      setLastRefresh(new Date());
      setRefreshError(null);
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? `Refresh failed: ${error.message}`
          : "Refresh failed; showing the last known snapshot.",
      );
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.jobs.filter((job) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "attention" && Boolean(job.failedStep)) ||
        job.status === filter;
      const matchesSearch =
        !query ||
        job.topic.toLowerCase().includes(query) ||
        job.contentId.includes(query) ||
        job.optionA.toLowerCase().includes(query) ||
        job.optionB.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [data.jobs, filter, search]);

  const selected =
    data.jobs.find((job) => job.contentId === selectedId) ??
    filteredJobs[0] ??
    data.jobs[0];
  const uploaded = data.jobs.filter((job) => job.status === "uploaded").length;
  const videoReady = data.jobs.filter((job) =>
    ["video_ready", "uploading", "uploaded"].includes(job.status),
  ).length;
  const attention = data.jobs.filter((job) => job.failedStep).length;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#" aria-label="YT Auto home">
          <span className="brand-mark">Y/A</span>
          <span>
            <b>YT AUTO</b>
            <small>PIPELINE CONSOLE</small>
          </span>
        </a>
        <div className="topbar-right">
          <span className={`source-badge source-${data.source}`}>
            <i />
            {data.source === "local" ? "LOCAL LIVE" : "GITHUB SNAPSHOT"}
          </span>
          <a
            className="github-link"
            href="https://github.com/Rendyprobe/YT-Auto"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>

      <div className="shell">
        <section className="hero">
          <div>
            <p className="eyebrow">FACELESS SHORTS / OPERATIONS</p>
            <h1>
              Every prompt.
              <br />
              <span>Every frame.</span> Accounted for.
            </h1>
          </div>
          <div className="hero-meta">
            <span>Auto-refresh / 30s</span>
            <button onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? "SYNCING…" : "SYNC NOW ↻"}
            </button>
            <small>Last check {formatDate(lastRefresh.toISOString())}</small>
            {refreshError && <small className="refresh-error">{refreshError}</small>}
          </div>
        </section>

        <section className="metrics" aria-label="Pipeline totals">
          <article>
            <span>01 / TOTAL JOBS</span>
            <strong>{String(data.jobs.length).padStart(2, "0")}</strong>
            <small>CSV rows tracked</small>
          </article>
          <article>
            <span>02 / VIDEO READY</span>
            <strong>{String(videoReady).padStart(2, "0")}</strong>
            <small>Ready to review</small>
          </article>
          <article>
            <span>03 / PUBLISHED</span>
            <strong>{String(uploaded).padStart(2, "0")}</strong>
            <small>YouTube uploads</small>
          </article>
          <article className={attention ? "metric-warning" : ""}>
            <span>04 / ATTENTION</span>
            <strong>{String(attention).padStart(2, "0")}</strong>
            <small>{attention ? "Action required" : "All systems nominal"}</small>
          </article>
        </section>

        <section className="workspace">
          <div className="queue-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CONTENT QUEUE</p>
                <h2>Production jobs</h2>
              </div>
              <span>{filteredJobs.length} shown</span>
            </div>
            <div className="filters">
              <label>
                <span className="sr-only">Search jobs</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search topic or ID…"
                />
              </label>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All stages</option>
                <option value="pending">Pending</option>
                <option value="audio_ready">Audio ready</option>
                <option value="video_ready">Video ready</option>
                <option value="uploaded">Uploaded</option>
                <option value="attention">Needs attention</option>
              </select>
            </div>
            <div className="job-list">
              {filteredJobs.map((job) => (
                <JobCard
                  key={job.contentId}
                  job={job}
                  selected={selected?.contentId === job.contentId}
                  onSelect={() => setSelectedId(job.contentId)}
                />
              ))}
              {!filteredJobs.length && (
                <div className="empty-list">No jobs match this filter.</div>
              )}
            </div>
          </div>

          {selected ? (
            <aside className="inspector">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">JOB INSPECTOR</p>
                  <h2>{selected.contentId}</h2>
                </div>
                <span className={`status-pill status-${selected.status}`}>
                  {STATUS_LABELS[selected.status]}
                </span>
              </div>

              <div className="inspector-grid">
                <MediaPanel job={selected} />
                <div className="job-details">
                  <section className="question-block">
                    <span>QUESTION</span>
                    <h3>{selected.topic}</h3>
                    <div className="result-bars">
                      <div>
                        <span>
                          A — {selected.optionA}
                          <b>{selected.percentageA}%</b>
                        </span>
                        <i style={{ width: `${selected.percentageA}%` }} />
                      </div>
                      <div>
                        <span>
                          B — {selected.optionB}
                          <b>{selected.percentageB}%</b>
                        </span>
                        <i style={{ width: `${selected.percentageB}%` }} />
                      </div>
                    </div>
                  </section>

                  {selected.failedStep && (
                    <section className="error-card">
                      <span>FAILED STEP / {selected.failedStep}</span>
                      <p>{selected.errorMessage ?? "No error detail recorded."}</p>
                    </section>
                  )}

                  <section className="audio-card">
                    <div>
                      <span>OPTION A AUDIO</span>
                      <small>{formatDuration(selected.durations.optionA)}</small>
                      {selected.media.audioAUrl ? (
                        <audio controls src={selected.media.audioAUrl} />
                      ) : (
                        <em>Not available on this host</em>
                      )}
                    </div>
                    <div>
                      <span>OPTION B AUDIO</span>
                      <small>{formatDuration(selected.durations.optionB)}</small>
                      {selected.media.audioBUrl ? (
                        <audio controls src={selected.media.audioBUrl} />
                      ) : (
                        <em>Not available on this host</em>
                      )}
                    </div>
                  </section>

                  <section className="timeline-card">
                    <div className="timeline-title">
                      <span>PIPELINE PROGRESS</span>
                      <small>{formatDate(selected.updatedAt)}</small>
                    </div>
                    <JobTimeline job={selected} />
                  </section>
                </div>
              </div>
            </aside>
          ) : (
            <aside className="inspector empty-list">No job selected.</aside>
          )}
        </section>

        <footer>
          <span>YT AUTO / RENDYPROBE</span>
          <span>Snapshot generated {formatDate(data.generatedAt)}</span>
          <span>NO SECRETS EXPOSED</span>
        </footer>
      </div>
    </main>
  );
}
