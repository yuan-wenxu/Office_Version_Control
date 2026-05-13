import fs from "fs-extra";
import { createPatch } from "diff";
import type { VersionRecord } from "../core/types.js";

export async function diffSnapshots(from: VersionRecord, to: VersionRecord): Promise<string> {
  const fromText = await fs.readFile(from.textPath, "utf8");
  const toText = await fs.readFile(to.textPath, "utf8");

  return createPatch(
    from.originalName,
    fromText,
    toText,
    `${from.id} ${from.createdAt}`,
    `${to.id} ${to.createdAt}`,
    { context: 3 }
  );
}
