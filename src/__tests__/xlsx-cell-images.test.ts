import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { embedImagesInCells } from "@/lib/xlsx-cell-images";

async function createWorkbook(): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("数据导出");
  sheet.columns = [
    { header: "学号", key: "student_id" },
    { header: "姓名", key: "name" },
    { header: "头像", key: "avatar_url" },
    { header: "评价", key: "evaluation_url" },
  ];
  sheet.addRow({ student_id: "S001", name: "学生甲" });
  sheet.addRow({ student_id: "S002", name: "学生乙" });
  return workbook.xlsx.writeBuffer();
}

describe("embedImagesInCells", () => {
  it("writes native rdRichValue parts and binds images to worksheet cells", async () => {
    const result = await embedImagesInCells(await createWorkbook(), [
      { cell: "C2", buffer: Buffer.from("avatar"), extension: "png" },
      { cell: "D3", buffer: Buffer.from("evaluation"), extension: "jpg" },
    ]);
    const zip = await JSZip.loadAsync(result);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    const metadata = await zip.file("xl/metadata.xml")?.async("text");
    const richValues = await zip.file("xl/richData/rdrichvalue.xml")?.async("text");
    const richStructure = await zip.file("xl/richData/rdrichvaluestructure.xml")?.async("text");
    const richTypes = await zip.file("xl/richData/rdRichValueTypes.xml")?.async("text");
    const richRelationships = await zip.file("xl/richData/richValueRel.xml")?.async("text");
    const imageRelationships = await zip.file("xl/richData/_rels/richValueRel.xml.rels")?.async("text");
    const workbookRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
    const workbook = await zip.file("xl/workbook.xml")?.async("text");

    expect(sheet).toContain('<c r="C2" t="e" vm="1"><v>#VALUE!</v></c>');
    expect(sheet).toContain('<c r="D3" t="e" vm="2"><v>#VALUE!</v></c>');
    expect(metadata).toContain('<metadataType name="XLRICHVALUE"');
    expect(metadata).toContain('<xlrd:rvb i="1"/>');
    expect(metadata).toContain('<rc t="1" v="1"/>');
    expect(richValues).toContain('<rv s="0"><v>0</v><v>5</v></rv>');
    expect(richValues).toContain('<rv s="0"><v>1</v><v>5</v></rv>');
    expect(richStructure).toContain('t="_localImage"');
    expect(richStructure).toContain('_rvRel:LocalImageIdentifier');
    expect(richTypes).toContain('_DisplayString');
    expect(richRelationships).toContain('<rel r:id="rId1"/>');
    expect(richRelationships).toContain('<rel r:id="rId2"/>');
    expect(imageRelationships).toContain('Target="../media/image1.png"');
    expect(imageRelationships).toContain('Target="../media/image2.jpg"');
    expect(workbookRels).toContain('Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue"');
    expect(workbookRels).toContain('Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel"');
    expect(workbookRels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata"');
    expect(workbook).toContain('microsoft.com:RD');
    expect(await zip.file("xl/media/image1.png")?.async("nodebuffer")).toEqual(Buffer.from("avatar"));
    expect(await zip.file("xl/media/image2.jpg")?.async("nodebuffer")).toEqual(Buffer.from("evaluation"));
  });

  it("rejects invalid cell references", async () => {
    await expect(embedImagesInCells(await createWorkbook(), [
      { cell: "not-a-cell", buffer: Buffer.from("image"), extension: "png" },
    ])).rejects.toThrow("Invalid Excel cell reference");
  });
});
