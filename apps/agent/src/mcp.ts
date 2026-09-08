#!/usr/bin/env node
/**
 * LUJAW MCP server — Binance Spot safety tools first; Venus secondary.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  cmdActivate,
  cmdCheck,
  cmdMarkets,
  cmdRescue,
  cmdRevoke,
  createRuntime,
  defaultStateDir,
  PUBLIC_PROBE_ACCOUNT,
} from "./runtime.js";
import {
  accountToolArgsSchema,
  activateToolArgsSchema,
  emptyToolArgsSchema,
} from "./tool-inputs.js";
import { binanceToolDefinitions, handleBinanceTool } from "./binance/tools.js";
import { venusToolDefinitions } from "./venus/tools.js";

if (existsSync(".env")) loadEnvFile(".env");

let statefulRuntime: ReturnType<typeof createRuntime> | null = null;

function getStatefulRuntime(requireOwner = false) {
  if (statefulRuntime === null) statefulRuntime = createRuntime({ requireOwner });
  if (requireOwner && !process.env.OWNER_PRIVATE_KEY?.trim()) {
    throw new Error("OWNER_PRIVATE_KEY is required for this operation");
  }
  return statefulRuntime;
}

const server = new Server(
  { name: "lujaw", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...binanceToolDefinitions, ...venusToolDefinitions],
}));

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          payload,
          (_k, v) => (typeof v === "bigint" ? v.toString(10) : v),
          2,
        ),
      },
    ],
  };
}

const BINANCE_TOOLS = new Set<string>(binanceToolDefinitions.map((t) => t.name));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (BINANCE_TOOLS.has(name)) {
      const result = await handleBinanceTool(name, args, {
        stateDir: defaultStateDir(),
      });
      return textResult(result);
    }
    if (name === "lujaw_check") {
      const parsed = accountToolArgsSchema.parse(args);
      const runtime = parsed.account
        ? createRuntime({ account: parsed.account as `0x${string}` })
        : getStatefulRuntime();
      const result = await cmdCheck(runtime);
      return textResult({ ok: true, ...result });
    }
    if (name === "lujaw_markets") {
      const parsed = accountToolArgsSchema.parse(args);
      const runtime = createRuntime({
        account: (parsed.account ?? PUBLIC_PROBE_ACCOUNT) as `0x${string}`,
      });
      const result = await cmdMarkets(runtime);
      return textResult({ ok: true, ...result });
    }
    if (name === "lujaw_activate") {
      const parsed = activateToolArgsSchema.parse(args);
      const preset = parsed.preset;
      const nl = parsed.nl;
      const accept = parsed.accept === true;
      const result = await cmdActivate(getStatefulRuntime(accept), {
        draft: {
          ...(typeof preset === "string"
            ? { preset: preset as "conservative" | "balanced" }
            : {}),
          ...(typeof nl === "string" ? { naturalLanguage: nl } : {}),
        },
        accept,
        ...(parsed.planHash ? { acceptedPlanHash: parsed.planHash as `0x${string}` } : {}),
      });
      return textResult(result);
    }
    if (name === "lujaw_rescue") {
      emptyToolArgsSchema.parse(args);
      const result = await cmdRescue(getStatefulRuntime());
      return textResult({ ok: true, ...result });
    }
    if (name === "lujaw_revoke") {
      emptyToolArgsSchema.parse(args);
      const result = await cmdRevoke(getStatefulRuntime(true));
      return textResult(result);
    }
    return textResult({ ok: false, error: `unknown tool ${name}` });
  } catch (error) {
    return textResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
