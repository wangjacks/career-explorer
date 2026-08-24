import { NextRequest, NextResponse } from "next/server";
import { getAllSubmitted } from "@/lib/db";
import JSZip from "jszip";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") || "all";
  const idsParam = searchParams.get("ids") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  // 图片打包导出审计（#110）：仅记范围参数，不记文件明细（含学生隐私）
  void recordAudit({
    ...actor, action: "export:images", method: "GET", path: "/api/manage/export-images",
    resource_type: "export", resource_id: null,
    status: "success", error_message: null, ip, user_agent,
    metadata: { scope },
  });

  const profiles = await getAllSubmitted();

  let filtered = profiles;

  if (scope === "byIds" && idsParam) {
    const filterIds = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    filtered = filtered.filter((r) => filterIds.includes(r.user_code));
  }

  if (scope === "date" && (dateFrom || dateTo)) {
    filtered = filtered.filter((r) => {
      if (!r.submitted_at) return false;
      const d = r.submitted_at.slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }

  const zip = new JSZip();
  let imageCount = 0;

  for (const row of filtered) {
    const urls: { url: string; filename: string }[] = [];
    if (row.avatar_url) urls.push({ url: row.avatar_url, filename: `${row.user_code}_avatar.jpg` });
    if (row.evaluation_url) urls.push({ url: row.evaluation_url, filename: `${row.user_code}_evaluation.jpg` });

    for (const { url, filename } of urls) {
      try {
        const fullUrl = new URL(url, request.url).toString();
        const res = await fetch(fullUrl);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        zip.file(filename, buffer);
        imageCount++;
      } catch (err) {
        console.warn("Failed to fetch image for zip:", url, err);
      }
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
