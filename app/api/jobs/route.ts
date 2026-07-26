import { NextResponse } from "next/server";

import { loadDashboardData } from "@/lib/dashboard-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(loadDashboardData(), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
