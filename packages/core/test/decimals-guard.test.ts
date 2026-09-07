import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard against the `decimals ?? 18` trap. Testnet mock USDT/USDC are 6 dp;
 * assuming 18 misprices by 1e12.
 */
describe("decimals fallback guard", () => {
  it("does not default missing decimals to 18 in core source", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcRoot = join(here, "..", "src");
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const text = readFileSync(path, "utf8");
        if (/decimals\s*\?\?\s*18/.test(text) || /underlyingDecimals\s*\?\?\s*18/.test(text)) {
          offenders.push(path);
        }
      }
    }

    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
