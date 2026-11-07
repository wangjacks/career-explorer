import JSZip from "jszip";

export interface CellImageEntry {
  cell: string;
  buffer: Buffer;
  extension: "png" | "jpg" | "gif" | "bmp" | "tif" | "webp";
}

const IMAGE_MIME: Record<CellImageEntry["extension"], string> = {
  bmp: "image/bmp",
  gif: "image/gif",
  jpg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  webp: "image/webp",
};

const RICH_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags><key name="_Self"><flag name="ExcludeFromFile" value="1"/><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_DisplayString"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Flags"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Format"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_SubLabel"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Attribution"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Icon"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_Display"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_CanonicalPropertyNames"><flag name="ExcludeFromCalcComparison" value="1"/></key><key name="_ClassificationId"><flag name="ExcludeFromCalcComparison" value="1"/></key></keyFlags></global></rvTypesInfo>`;

const RICH_STRUCTURE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`;

function normalizeCell(cell: string): string {
  const value = cell.trim().toUpperCase();
  if (!/^[A-Z]+[1-9][0-9]*$/.test(value)) throw new Error(`Invalid Excel cell reference: ${cell}`);
  return value;
}

function columnToNumber(column: string): number {
  return [...column].reduce((result, character) => result * 26 + character.charCodeAt(0) - 64, 0);
}

function nextRelationshipId(xml: string): number {
  const ids = [...xml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return ids.length ? Math.max(...ids) + 1 : 1;
}

function appendRelationship(xml: string, value: string): string {
  return xml.includes(value) ? xml : xml.replace("</Relationships>", `${value}</Relationships>`);
}

/** 单元格已存在则改写为 rich value 单元格；否则追加到对应行并同步行 spans。 */
function updateCell(xml: string, cell: string, vm: number): string {
  const escaped = cell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cellPattern = new RegExp(`<c\\s+([^>]*\\br="${escaped}"[^>]*)>[\\s\\S]*?<\\/c>`);
  if (cellPattern.test(xml)) {
    return xml.replace(cellPattern, `<c r="${cell}" t="e" vm="${vm}"><v>#VALUE!</v></c>`);
  }

  const rowNumber = Number(cell.match(/[0-9]+$/)?.[0]);
  const rowPattern = new RegExp(`<row\\s+([^>]*\\br="${rowNumber}"[^>]*)>([\\s\\S]*?)<\\/row>`);
  const rowMatch = xml.match(rowPattern);
  if (!rowMatch) throw new Error(`Worksheet row not found for cell ${cell}`);
  const inserted = xml.replace(rowPattern, `<row ${rowMatch[1]}>${rowMatch[2]}<c r="${cell}" t="e" vm="${vm}"><v>#VALUE!</v></c></row>`);
  return inserted.replace(rowPattern, (fullRow, attributes: string) => {
    const spans = attributes.match(/\sspans="(\d+):(\d+)"/);
    if (!spans) return fullRow;
    const column = cell.match(/^([A-Z]+)/)?.[1] ?? "A";
    const columnNumber = columnToNumber(column);
    const min = Math.min(Number(spans[1]), columnNumber);
    const max = Math.max(Number(spans[2]), columnNumber);
    return `<row ${attributes.replace(/\sspans="\d+:\d+"/, ` spans="${min}:${max}"`)}>` + fullRow.slice(fullRow.indexOf(">") + 1);
  });
}

function metadataXml(count: number): string {
  const future = Array.from({ length: count }, (_, index) =>
    `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${index}"/></ext></extLst></bk>`
  ).join("");
  const values = Array.from({ length: count }, (_, index) => `<bk><rc t="1" v="${index}"/></bk>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes><futureMetadata name="XLRICHVALUE" count="${count}">${future}</futureMetadata><valueMetadata count="${count}">${values}</valueMetadata></metadata>`;
}

function richValuesXml(count: number): string {
  const values = Array.from({ length: count }, (_, index) => `<rv s="0"><v>${index}</v><v>5</v></rv>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="${count}">${values}</rvData>`;
}

function richRelationshipsXml(count: number): string {
  const rels = Array.from({ length: count }, (_, index) => `<rel r:id="rId${index + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${rels}</richValueRels>`;
}

function imageRelationshipsXml(entries: CellImageEntry[]): string {
  const rels = entries.map((entry, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.${entry.extension}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function addContentTypes(xml: string, entries: CellImageEntry[]): string {
  let result = xml;
  for (const extension of [...new Set(entries.map((entry) => entry.extension))]) {
    if (!result.includes(`Extension="${extension}"`)) {
      result = result.replace("</Types>", `<Default Extension="${extension}" ContentType="${IMAGE_MIME[extension]}"/></Types>`);
    }
  }
  const overrides: [string, string][] = [
    ["/xl/metadata.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml"],
    ["/xl/richData/richValueRel.xml", "application/vnd.ms-excel.richvaluerel+xml"],
    ["/xl/richData/rdrichvalue.xml", "application/vnd.ms-excel.rdrichvalue+xml"],
    ["/xl/richData/rdrichvaluestructure.xml", "application/vnd.ms-excel.rdrichvaluestructure+xml"],
    ["/xl/richData/rdRichValueTypes.xml", "application/vnd.ms-excel.rdrichvaluetypes+xml"],
  ];
  for (const [part, type] of overrides) {
    if (!result.includes(`PartName="${part}"`)) result = result.replace("</Types>", `<Override PartName="${part}" ContentType="${type}"/></Types>`);
  }
  return result;
}

/** 在 workbook.xml 中声明 RD（Rich Data）计算特性，Excel 依赖它解析单元格图片。 */
function addRichDataCalcFeature(xml: string): string {
  if (xml.includes("microsoft.com:RD")) return xml;
  const extLst = `<extLst><ext uri="{B58B0392-4F1F-4190-BB64-5DF3571DCE5F}" xmlns:xcalcf="http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures"><xcalcf:calcFeatures><xcalcf:feature name="microsoft.com:RD"/></xcalcf:calcFeatures></ext></extLst>`;
  return xml.replace("</workbook>", `${extLst}</workbook>`);
}

/**
 * 将图片以 Excel 原生「放置在单元格中」（rdRichValue + RD 计算特性）写入 ExcelJS 生成的最终 XLSX。
 * 注入必须发生在最后一次写出之后，避免 ExcelJS 丢弃未知部件。
 */
export async function embedImagesInCells(workbookBuffer: ArrayBuffer | Buffer, entries: CellImageEntry[]): Promise<Buffer> {
  if (!entries.length) return Buffer.isBuffer(workbookBuffer) ? workbookBuffer : Buffer.from(new Uint8Array(workbookBuffer));
  const normalized = entries.map((entry) => ({ ...entry, cell: normalizeCell(entry.cell) }));
  const zip = await JSZip.loadAsync(workbookBuffer);
  const sheetFile = zip.file("xl/worksheets/sheet1.xml");
  const relsFile = zip.file("xl/_rels/workbook.xml.rels");
  const typesFile = zip.file("[Content_Types].xml");
  const workbookFile = zip.file("xl/workbook.xml");
  if (!sheetFile || !relsFile || !typesFile || !workbookFile) throw new Error("Invalid XLSX: required parts are missing");

  let sheet = await sheetFile.async("text");
  normalized.forEach((entry, index) => {
    sheet = updateCell(sheet, entry.cell, index + 1);
    zip.file(`xl/media/image${index + 1}.${entry.extension}`, entry.buffer);
  });
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/metadata.xml", metadataXml(normalized.length));
  zip.file("xl/richData/rdrichvalue.xml", richValuesXml(normalized.length));
  zip.file("xl/richData/rdrichvaluestructure.xml", RICH_STRUCTURE);
  zip.file("xl/richData/rdRichValueTypes.xml", RICH_TYPES);
  zip.file("xl/richData/richValueRel.xml", richRelationshipsXml(normalized.length));
  zip.file("xl/richData/_rels/richValueRel.xml.rels", imageRelationshipsXml(normalized));

  const rels = await relsFile.async("text");
  const id = nextRelationshipId(rels);
  let updatedRels = rels;
  updatedRels = appendRelationship(updatedRels, `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sheetMetadata" Target="metadata.xml"/>`);
  updatedRels = appendRelationship(updatedRels, `<Relationship Id="rId${id + 1}" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/>`);
  updatedRels = appendRelationship(updatedRels, `<Relationship Id="rId${id + 2}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>`);
  updatedRels = appendRelationship(updatedRels, `<Relationship Id="rId${id + 3}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>`);
  updatedRels = appendRelationship(updatedRels, `<Relationship Id="rId${id + 4}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes" Target="richData/rdRichValueTypes.xml"/>`);
  zip.file("xl/_rels/workbook.xml.rels", updatedRels);

  zip.file("xl/workbook.xml", addRichDataCalcFeature(await workbookFile.async("text")));
  const types = await typesFile.async("text");
  zip.file("[Content_Types].xml", addContentTypes(types, normalized));
  return zip.generateAsync({ type: "nodebuffer" });
}
