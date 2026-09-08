import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activateToolArgsSchema, episodeExitCode } from "../src/tool-inputs.js";
import { createRuntime } from "../src/runtime.js";

const savedOwner = process.env.OWNER_PRIVATE_KEY;
const savedAccount = process.env.LUJAW_ACCOUNT;
const savedRpc = process.env.BSC_TESTNET_RPC_URL;
afterEach(() => {
  if (savedOwner === undefined) delete process.env.OWNER_PRIVATE_KEY;
  else process.env.OWNER_PRIVATE_KEY = savedOwner;
  if (savedAccount === undefined) delete process.env.LUJAW_ACCOUNT;
  else process.env.LUJAW_ACCOUNT = savedAccount;
  if (savedRpc === undefined) delete process.env.BSC_TESTNET_RPC_URL;
  else process.env.BSC_TESTNET_RPC_URL = savedRpc;
});

/**
 * Conformance: CLI and MCP expose the same four operation names and share
 * runtime imports. This is a static parity check (no live chain).
 */
const here = dirname(fileURLToPath(import.meta.url));
const agentSrc = join(here, "..", "src");

describe("CLI ↔ MCP conformance", () => {
  it("exposes identical tool/command surface", () => {
    const cli = readFileSync(join(agentSrc, "cli.ts"), "utf8");
    const mcp = readFileSync(join(agentSrc, "mcp.ts"), "utf8");
    const runtime = readFileSync(join(agentSrc, "runtime.ts"), "utf8");

    for (const op of ["check", "activate", "rescue", "revoke"]) {
      expect(cli).toContain(`command === "${op}"`);
      expect(mcp).toContain(`lujaw_${op}`);
      expect(runtime).toMatch(new RegExp(`cmd${op[0]!.toUpperCase()}${op.slice(1)}`));
    }

    expect(mcp).toContain('from "./runtime.js"');
    expect(cli).toContain('from "./runtime.js"');
  });

  it("rejects truthy non-boolean activation acceptance", () => {
    expect(() => activateToolArgsSchema.parse({ preset: "balanced", accept: "false" })).toThrow();
    expect(() => activateToolArgsSchema.parse({ preset: "balanced", accept: true })).toThrow();
    expect(activateToolArgsSchema.parse({ preset: "balanced", accept: false }).accept).toBe(false);
  });

  it("returns non-zero for blocked and failed episodes", () => {
    expect(episodeExitCode("HELD")).toBe(0);
    expect(episodeExitCode("EXECUTED")).toBe(0);
    expect(episodeExitCode("BLOCKED")).toBe(1);
    expect(episodeExitCode("FAILED")).toBe(2);
  });

  it("creates a read-only runtime without loading OWNER_PRIVATE_KEY", () => {
    delete process.env.OWNER_PRIVATE_KEY;
    process.env.LUJAW_ACCOUNT = "0x4444444444444444444444444444444444444444";
    process.env.BSC_TESTNET_RPC_URL = "http://localhost:8545";
    expect(createRuntime().account).toBe(process.env.LUJAW_ACCOUNT);
    expect(() => createRuntime({ requireOwner: true })).toThrow(/OWNER_PRIVATE_KEY/);
  });
});
