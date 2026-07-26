import { NextResponse } from "next/server";

import {
  loadQueue,
  QueueStoreError,
  saveQueue,
} from "@/lib/queue-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  const known = error instanceof QueueStoreError;
  const message = known ? error.message : "Unexpected queue storage error.";
  if (!known) {
    console.error(
      "Unexpected queue API failure.",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
  return NextResponse.json(
    { error: message },
    { status: known ? error.statusCode : 500 },
  );
}

export async function GET() {
  try {
    return NextResponse.json(await loadQueue(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 1_000_000) {
    return NextResponse.json(
      { error: "Queue request is too large." },
      { status: 413 },
    );
  }
  try {
    const body = (await request.json()) as { rows?: unknown };
    return NextResponse.json(await saveQueue(body.rows), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
