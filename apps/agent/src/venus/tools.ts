/**
 * Venus Care Plan MCP tool definitions (secondary adapter).
 */
export const venusToolDefinitions = [
  {
    name: "lujaw_check",
    description:
      "[Venus secondary] Read-only Venus health check for an account argument or the configured owner account. Writes an episode. AT_RISK returns HELD with CHECK_ONLY_AT_RISK (no spend).",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_markets",
    description:
      "[Venus secondary] Read-only live capability report for configured Venus markets. Separates observation verification, current supply availability, and execution verification.",
    inputSchema: {
      type: "object",
      properties: {
        account: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_activate",
    description:
      "[Venus secondary] Draft and optionally grant a Care Plan session. Preset needs no LLM; NL uses AgentRouter. Requires accept=true plus the displayed planHash to grant.",
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
      "[Venus secondary] Evaluate and optionally execute a single buffered mint top-up under the active Care Plan.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_revoke",
    description:
      "[Venus secondary] Revoke the live Altana session and disclose remaining ERC-20 allowance. Does not clear allowance.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
] as const;
