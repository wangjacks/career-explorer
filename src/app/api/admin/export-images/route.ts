import { NextRequest, NextResponse } from "next/server";
import { getAllProfilesRaw } from "@/lib/db";
import JSZip from "jszip";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "all";
  const idsParam = searchParams.get("ids") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const profiles = await getAllProfilesRaw();

  let filtered = profiles;

  if (scope === "byIds" && idsParam) {
    const filterIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    filtered = filtered.filter((r) => filterIds.includes(r.student_id));
  }

  if (scope === "date" && (dateFrom || dateTo)) {
    filtered = filtered.filter((r) => {
      if (!r.created_at) return false;
      const d = r.created_at.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  const zip = new JSZip();
  let imageCount = 0;

  for (const row of filtered) {
    const urls: { url: string; filename: string }[] = [];
    if (row.avatar_url) urls.push({ url: row.avatar_url, filename: `${row.student_id}_avatar.jpg` });
    if (row.evaluation_url) urls.push({ url: row.evaluation_url, filename: `${row.student_id}_evaluation.jpg` });

    for (const { url, filename } of urls) {
      try {
        const fullUrl = new URL(url, request.url).toString();
        const res = await fetch(fullUrl);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        zip.file(filename, buffer);
        imageCount++;
      } catch {}
    }
  }

  if (imageCount === 0) {
    return NextResponse.json({ error: "没有可下载的图片" }, { status: 404 });
  }

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

  return new NextResponse(zipBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images_${Date.now()}.zip"`,
    },
  });
}
