#!/usr/bin/env tsx
/**
 * LUJAW MCP server — same four ops as the CLI, shared runtime.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  cmdActivate,
  cmdCheck,
  cmdRescue,
  cmdRevoke,
  createRuntime,
} from "./runtime.js";
import { activateToolArgsSchema, emptyToolArgsSchema } from "./tool-inputs.js";

const runtime = createRuntime();

const server = new Server(
  { name: "lujaw", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "lujaw_check",
      description:
        "Read-only Venus health check for the configured owner account. Writes an episode. AT_RISK returns HELD with CHECK_ONLY_AT_RISK (no spend).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "lujaw_activate",
      description:
        "Draft and optionally grant a Care Plan session. Preset needs no LLM; NL uses AgentRouter schema-constrained output. Requires accept=true plus the displayed planHash to grant. Fresh session key every grant.",
      inputSchema: {
        type: "object",
        properties: {
          preset: { type: "string", enum: ["conservative", "balanced"] },
          nl: { type: "string" },
          accept: { type: "boolean" },
          planHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "lujaw_rescue",
      description:
        "Evaluate and optionally execute a single buffered mint top-up under the active Care Plan. Requires live grant from activate in this process.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "lujaw_revoke",
      description:
        "Revoke the live Altana session and disclose remaining ERC-20 allowance. Does not clear allowance.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (name === "lujaw_check") {
      emptyToolArgsSchema.parse(args);
      const result = await cmdCheck(runtime);
      return textResult({ ok: true, ...result });
    }
    if (name === "lujaw_activate") {
      const parsed = activateToolArgsSchema.parse(args);
      const preset = parsed.preset;
      const nl = parsed.nl;
      const accept = parsed.accept === true;
      const result = await cmdActivate(runtime, {
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
      const result = await cmdRescue(runtime);
      return textResult({ ok: true, ...result });
    }
    if (name === "lujaw_revoke") {
      emptyToolArgsSchema.parse(args);
      const result = await cmdRevoke(runtime);
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
