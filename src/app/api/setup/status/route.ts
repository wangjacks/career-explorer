import { NextResponse } from "next/server";
import { isInstalled } from "@/lib/db-config";

export async function GET() {
  return NextResponse.json({ installed: isInstalled() });
}
