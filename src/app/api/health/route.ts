import { NextResponse } from "next/server";

/**
 * GET /api/health
 * Lightweight liveness probe used by ConnectivityService to verify the server
 * is reachable. Returns no sensitive data. Cache-Control: no-store ensures
 * the browser never serves a cached response as proof of connectivity.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Pragma": "no-cache",
      },
    }
  );
}
