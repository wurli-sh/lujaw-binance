#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "src", "cli.ts");
const result = spawnSync("pnpm", ["exec", "tsx", cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: false,
});
process.exit(result.status ?? 1);
