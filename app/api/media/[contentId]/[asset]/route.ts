import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { getPipelineRoot } from "@/lib/pipeline-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASSETS = {
  "option-a": {
    parts: ["audio", "option_a.mp3"],
    contentType: "audio/mpeg",
  },
  "option-b": {
    parts: ["audio", "option_b.mp3"],
    contentType: "audio/mpeg",
  },
  video: {
    parts: ["videos"],
    contentType: "video/mp4",
  },
} as const;

type RouteContext = {
  params: Promise<{ contentId: string; asset: string }>;
};

function responseBody(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
}

export async function GET(request: Request, context: RouteContext) {
  const { contentId, asset } = await context.params;
  if (!/^[a-f0-9]{12,64}$/.test(contentId) || !(asset in ASSETS)) {
    return Response.json({ error: "Invalid media request" }, { status: 400 });
  }

  const definition = ASSETS[asset as keyof typeof ASSETS];
  const root = getPipelineRoot();
  const filePath =
    asset === "video"
      ? path.join(root, "output", "videos", `${contentId}.mp4`)
      : path.join(
          root,
          "output",
          "audio",
          contentId,
          asset === "option-a" ? "option_a.mp3" : "option_b.mp3",
        );

  try {
    const info = await stat(filePath);
    const range = request.headers.get("range");
    if (!range) {
      return new Response(responseBody(filePath), {
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "Content-Length": String(info.size),
          "Content-Type": definition.contentType,
        },
      });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : info.size - 1;
    if (start < 0 || end < start || end >= info.size) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    }
    return new Response(responseBody(filePath, start, end), {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${info.size}`,
        "Content-Type": definition.contentType,
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "Media is unavailable here. Run the dashboard on the pipeline machine or use a YouTube URL.",
      },
      { status: 404 },
    );
  }
}
