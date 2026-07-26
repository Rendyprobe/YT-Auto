"use client";

import { useMemo, useState } from "react";

import { DashboardJob } from "@/lib/dashboard-types";

function embedUrl(job: DashboardJob) {
  return job.media.youtubeVideoId && job.media.privacy !== "private"
    ? `https://www.youtube-nocookie.com/embed/${job.media.youtubeVideoId}`
    : null;
}

export function VideoLibrary({ jobs }: { jobs: DashboardJob[] }) {
  const available = useMemo(
    () =>
      jobs.filter(
        (job) =>
          job.media.videoUrl ||
          job.media.youtubeUrl ||
          ["video_ready", "uploading", "uploaded"].includes(job.status),
      ),
    [jobs],
  );
  const [selectedId, setSelectedId] = useState(
    available[0]?.contentId ?? "",
  );
  const selected =
    available.find((job) => job.contentId === selectedId) ?? available[0];

  if (!available.length) {
    return (
      <section className="control-panel video-empty">
        <span className="empty-icon">00</span>
        <p className="eyebrow">VIDEO LIBRARY</p>
        <h2>Belum ada video final.</h2>
        <p>
          Pipeline baru selesai sampai pembuatan audio. Setelah modul layout dan
          render selesai, MP4 akan muncul di sini dan bisa diputar atau
          diunduh.
        </p>
        <code>output/videos/&lt;content_id&gt;.mp4</code>
      </section>
    );
  }

  const youtube = selected ? embedUrl(selected) : null;
  return (
    <section className="control-panel video-library">
      <div className="control-heading">
        <div>
          <p className="eyebrow">RENDER OUTPUT</p>
          <h2>Video library</h2>
          <p>Pilih hasil render, tonton penuh, lalu unduh atau buka YouTube.</p>
        </div>
        <span>{available.length} video</span>
      </div>
      <div className="library-grid">
        <div className="library-list">
          {available.map((job) => (
            <button
              key={job.contentId}
              className={selected?.contentId === job.contentId ? "selected" : ""}
              type="button"
              onClick={() => setSelectedId(job.contentId)}
            >
              <span>{job.status.replaceAll("_", " ")}</span>
              <strong>{job.topic}</strong>
              <code>{job.contentId}</code>
            </button>
          ))}
        </div>
        {selected && (
          <div className="library-player">
            <div className="library-phone">
              {selected.media.videoUrl ? (
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={selected.media.videoUrl}
                />
              ) : youtube ? (
                <iframe
                  title={selected.topic}
                  src={youtube}
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <div>
                  Video tercatat siap, tetapi file hanya tersedia di mesin
                  render.
                </div>
              )}
            </div>
            <h3>{selected.topic}</h3>
            <div className="library-actions">
              {selected.media.videoUrl && (
                <a href={selected.media.videoUrl} download>
                  Download MP4 ↓
                </a>
              )}
              {selected.media.youtubeUrl && (
                <a
                  href={selected.media.youtubeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open YouTube ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
