import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import fs from "fs-extra";
import { detectOfficeKind } from "./detect.js";

export async function extractOfficeText(filePath: string): Promise<string> {
  const kind = detectOfficeKind(filePath);

  if (kind === "docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    return normalizeText(result.value);
  }

  if (kind === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const parts = workbook.worksheets.map((sheet) => {
      const rows: string[] = [];
      sheet.eachRow({ includeEmpty: true }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map((value) => csvCell(value)).join(","));
      });
      return `# ${sheet.name}\n${rows.join("\n")}`;
    });
    return normalizeText(parts.join("\n\n"));
  }

  if (kind === "pptx") {
    return extractPptxText(filePath);
  }

  return "";
}

async function extractPptxText(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: string[] = [];
  for (const slideName of slideNames) {
    const xml = await zip.files[slideName].async("text");
    const text = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)]
      .map((match) => decodeXml(match[1] ?? ""))
      .join("\n");
    slides.push(`# ${path.basename(slideName, ".xml")}\n${text}`);
  }

  return normalizeText(slides.join("\n\n"));
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object" && "text" in value
        ? String((value as { text: unknown }).text)
        : String(value);

  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
