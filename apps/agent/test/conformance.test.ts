import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { activateToolArgsSchema, episodeExitCode, policyCreateToolArgsSchema } from "../src/tool-inputs.js";
import { createRuntime } from "../src/runtime.js";
import { handleBinanceTool } from "../src/binance/tools.js";
import { normalizeSpotObservation } from "../src/binance/normalize.js";

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

const here = dirname(fileURLToPath(import.meta.url));
const agentSrc = join(here, "..", "src");
const repoRoot = join(here, "../../..");

describe("CLI ↔ MCP conformance", () => {
  it("exposes identical Venus tool/command surface", () => {
    const cli = readFileSync(join(agentSrc, "cli.ts"), "utf8");
    const mcp = readFileSync(join(agentSrc, "mcp.ts"), "utf8");
    const runtime = readFileSync(join(agentSrc, "runtime.ts"), "utf8");

    for (const op of ["check", "markets", "activate", "rescue", "revoke"]) {
      expect(cli).toContain(`command === "${op}"`);
      expect(mcp).toContain(`lujaw_${op}`);
      expect(runtime).toMatch(new RegExp(`cmd${op[0]!.toUpperCase()}${op.slice(1)}`));
    }

    expect(mcp).toContain('from "./runtime.js"');
    expect(cli).toContain('from "./runtime.js"');
  });

  it("lists Binance Spot tools before Venus tools over real MCP stdio", async () => {
    const transport = new StdioClientTransport({
      command: "pnpm",
      args: ["exec", "tsx", join(agentSrc, "mcp.ts")],
      cwd: join(here, ".."),
      stderr: "pipe",
    });
    const client = new Client({ name: "lujaw-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual([
        "lujaw_policy_create",
        "lujaw_order_preflight",
        "lujaw_order_authorize",
        "lujaw_episode_verify",
        "lujaw_check",
        "lujaw_markets",
        "lujaw_activate",
        "lujaw_rescue",
        "lujaw_revoke",
      ]);

      const invalid = await client.callTool({
        name: "lujaw_check",
        arguments: { account: "not-an-address" },
      });
      const text = invalid.content.find((entry) => entry.type === "text");
      expect(text?.type === "text" ? JSON.parse(text.text) : null).toMatchObject({ ok: false });
    } finally {
      await client.close();
    }
  }, 15_000);

  it("rejects truthy non-boolean activation acceptance", () => {
    expect(() => activateToolArgsSchema.parse({ preset: "balanced", accept: "false" })).toThrow();
    expect(() => activateToolArgsSchema.parse({ preset: "balanced", accept: true })).toThrow();
    expect(activateToolArgsSchema.parse({ preset: "balanced", accept: false }).accept).toBe(false);
  });

  it("requires policyHash when accepting Spot policy", () => {
    expect(() => policyCreateToolArgsSchema.parse({ accept: true })).toThrow();
    expect(policyCreateToolArgsSchema.parse({ preset: "demo", accept: false }).preset).toBe("demo");
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

describe("Binance Spot MCP fixture flow", () => {
  it("accepts Binance's zero MARKET_LOT_SIZE step as an unset market increment", () => {
    const exchange = JSON.parse(
      readFileSync(join(repoRoot, "fixtures/binance-mcp/exchange-info-bnbusdt.json"), "utf8"),
    );
    const marketLot = exchange.filters.find(
      (filter: { filterType: string }) => filter.filterType === "MARKET_LOT_SIZE",
    );
    marketLot.stepSize = "0.00000000";
    const book = JSON.parse(
      readFileSync(join(repoRoot, "fixtures/binance-mcp/book-bnbusdt.json"), "utf8"),
    );

    const observation = normalizeSpotObservation({
      accountRef: "agentic-subaccount-redacted",
      observedAt: Date.now(),
      symbol: "BNBUSDT",
      exchangeInfo: exchange,
      book,
      balances: [],
    });

    expect(observation.filters.marketStepSize).toBeUndefined();
    expect(observation.filters.marketMinQty).toBe("0.00100000");
    expect(observation.filters.marketMaxQty).toBe("1000.00000000");
  });

  it("allows a clearly simulated 10 USDT buy while preserving the 5 USDT reserve", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "lujaw-binance-simulation-"));
    try {
      const draft = await handleBinanceTool(
        "lujaw_policy_create",
        { preset: "demo", accountRef: "SIMULATED-20-USDT", accept: false },
        { stateDir },
      ) as { ok: boolean; policyHash: string };
      const active = await handleBinanceTool(
        "lujaw_policy_create",
        { accept: true, policyHash: draft.policyHash },
        { stateDir },
      ) as { ok: boolean };
      expect(active.ok).toBe(true);

      const exchange = JSON.parse(
        readFileSync(join(repoRoot, "fixtures/binance-mcp/exchange-info-bnbusdt.json"), "utf8"),
      );
      const book = JSON.parse(
        readFileSync(join(repoRoot, "fixtures/binance-mcp/book-bnbusdt.json"), "utf8"),
      );
      const observation = normalizeSpotObservation({
        accountRef: "SIMULATED-20-USDT",
        observedAt: Date.now(),
        symbol: "BNBUSDT",
        exchangeInfo: exchange,
        book,
        balances: [
          { asset: "USDT", free: "20.00000000", locked: "0.00000000" },
          { asset: "BNB", free: "0.00000000", locked: "0.00000000" },
        ],
        sources: {
          market: "fixture.exchange-info",
          account: "SIMULATED — not a Binance account response",
          book: "fixture.depth",
        },
      });
      const result = await handleBinanceTool(
        "lujaw_order_preflight",
        {
          intent: {
            version: "lujaw.binance-spot-intent/1",
            symbol: "BNBUSDT",
            side: "BUY",
            type: "MARKET",
            quoteOrderQty: "10",
            requestedAt: Math.floor(Date.now() / 1000),
          },
          observation,
        },
        { stateDir },
      ) as { ok: boolean; preflight: { decision: string; authorizedOrder: { quoteOrderQty: string } | null } };

      expect(result).toMatchObject({
        ok: true,
        preflight: { decision: "ALLOW", authorizedOrder: { quoteOrderQty: "10" } },
      });
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("drafts, preflights REDUCE, authorizes, and verifies without network", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "lujaw-binance-"));
    try {
      const draft = await handleBinanceTool(
        "lujaw_policy_create",
        { preset: "demo", accountRef: "agentic-subaccount-redacted", accept: false },
        { stateDir },
      ) as { ok: boolean; policyHash: string };
      expect(draft.ok).toBe(true);

      const active = await handleBinanceTool(
        "lujaw_policy_create",
        { accept: true, policyHash: draft.policyHash },
        { stateDir },
      ) as { ok: boolean; state: string };
      expect(active).toMatchObject({ ok: true, state: "ACTIVE" });

      const exchange = JSON.parse(
        readFileSync(join(repoRoot, "fixtures/binance-mcp/exchange-info-bnbusdt.json"), "utf8"),
      );
      const book = JSON.parse(
        readFileSync(join(repoRoot, "fixtures/binance-mcp/book-bnbusdt.json"), "utf8"),
      );
      const account = JSON.parse(
        readFileSync(join(repoRoot, "fixtures/binance-mcp/account.redacted.json"), "utf8"),
      );
      const observation = normalizeSpotObservation({
        accountRef: account.accountRef,
        observedAt: Date.now(),
        symbol: "BNBUSDT",
        exchangeInfo: exchange,
        book,
        balances: account.balances,
      });

      const preflight = await handleBinanceTool(
        "lujaw_order_preflight",
        {
          intent: {
            version: "lujaw.binance-spot-intent/1",
            symbol: "BNBUSDT",
            side: "BUY",
            type: "MARKET",
            quoteOrderQty: "1000",
            requestedAt: Math.floor(Date.now() / 1000),
          },
          observation,
        },
        { stateDir },
      ) as { ok: boolean; preflight: { decision: string; preflightHash: string; authorizedOrder: { quoteOrderQty: string } } };
      expect(preflight.ok).toBe(true);
      expect(preflight.preflight.decision).toBe("REDUCE");

      const auth = await handleBinanceTool(
        "lujaw_order_authorize",
        { preflightHash: preflight.preflight.preflightHash, accept: true },
        { stateDir },
      ) as { ok: boolean; authorizationHash: string; authorization: { authorizedOrder: { quoteOrderQty: string } } };
      expect(auth.ok).toBe(true);

      const quote = auth.authorization.authorizedOrder.quoteOrderQty;
      const verified = await handleBinanceTool(
        "lujaw_episode_verify",
        {
          authorizationHash: auth.authorizationHash,
          evidence: {
            orderId: 1,
            clientOrderId: "fixture",
            status: "FILLED",
            executedQty: "0.01",
            cumulativeQuoteQty: quote,
            fills: [{ price: "600.1", qty: "0.01", commission: "0", commissionAsset: "BNB" }],
            preBalances: account.balances,
            postBalances: account.balances,
            hostAttested: false,
          },
        },
        { stateDir },
      ) as { ok: boolean; episode: { outcome: string } };
      expect(verified.ok).toBe(true);
      expect(verified.episode.outcome).toBe("VERIFIED");
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
