import { NextResponse } from "next/server";

export function apiError(message: string, status: number, requestId = crypto.randomUUID()) {
  return NextResponse.json({ error: { message, requestId } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}
