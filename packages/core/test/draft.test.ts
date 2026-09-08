import { describe, expect, it, vi } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDeployment } from "../src/deployment.js";
import { draftCarePlan, type AgentRouterChatClient } from "../src/draft/agentrouter.js";

const here = dirname(fileURLToPath(import.meta.url));
const deployment = loadDeployment(
  join(here, "..", "..", "..", "deployments", "bsc-testnet.json"),
);

describe("AgentRouter Care Plan draft", () => {
  it("drafts conservative without calling AgentRouter", async () => {
    const result = await draftCarePlan(
      { preset: "conservative", nowSeconds: 1_700_000_000 },
      deployment,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.validation.ok).toBe(true);
  });

  it("errors clearly when NL requested without API key", async () => {
    const previous = process.env.AGENT_ROUTER_API_KEY;
    delete process.env.AGENT_ROUTER_API_KEY;
    const result = await draftCarePlan(
      { naturalLanguage: "intervene at 1.5 restore to 1.7 max 10 USDT for 12 hours" },
      deployment,
    );
    if (previous !== undefined) process.env.AGENT_ROUTER_API_KEY = previous;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("AGENT_ROUTER_KEY_MISSING");
  });

  it("uses mocked AgentRouter structured output and overwrites protocol from deployment", async () => {
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              interveneBelow: "1.50",
              alertBelow: null,
              restoreTo: "1.70",
              maxTopUpUsdt: "10",
              sessionHours: "12",
              followUpQuestion: null,
              chainId: 56,
              supplyTarget: "0xdead",
            }),
          },
        },
      ],
    }));
    const client = { chat: { completions: { create } } } as AgentRouterChatClient;
    const result = await draftCarePlan(
      {
        naturalLanguage: "keep me safe around 1.5",
        agentRouterClient: client,
        nowSeconds: 1_700_000_000,
      },
      deployment,
    );
    expect(create).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    if (!result.ok || !result.validation.ok) return;
    expect(result.validation.plan.chainId).toBe(97);
    expect(result.validation.plan.supplyTarget.toLowerCase()).toBe(
      deployment.venus.market.supplyTarget.toLowerCase(),
    );
    expect(result.validation.plan.alertBelow).toBe("1.55");
    expect(result.validation.plan.maxTopUpRaw).toBe("10000000");
  });

  it("rejects an NL budget above the locked cap instead of clamping it", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: JSON.stringify({
              interveneBelow: "1.50",
              alertBelow: "1.55",
              restoreTo: "1.70",
              maxTopUpUsdt: "26",
              sessionHours: "12",
            }) } }],
          })),
        },
      },
    } as AgentRouterChatClient;
    const result = await draftCarePlan({ naturalLanguage: "max 26 USDT", agentRouterClient: client }, deployment);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DRAFT_INVALID");
  });
});
