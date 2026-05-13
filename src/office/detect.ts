import path from "node:path";
import type { OfficeKind } from "../core/types.js";

const supported = new Set([".docx", ".xlsx", ".pptx"]);
const officeExts = new Set([".doc", ".xls", ".ppt", ".odt", ".ods", ".odp"]);

export function detectOfficeKind(filePath: string): OfficeKind {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".docx") return "docx";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".pptx") return "pptx";
  if (officeExts.has(ext)) return "office";
  return "unknown";
}

export function isSupportedOfficeFile(filePath: string): boolean {
  return supported.has(path.extname(filePath).toLowerCase());
}
