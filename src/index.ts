#!/usr/bin/env node
import { buildCli } from "./cli.js";

buildCli().parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
