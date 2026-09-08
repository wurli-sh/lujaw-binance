/**
 * Binance Spot MCP tool definitions and handlers.
 */
import {
  buildSpotEpisode,
  createSpotAuthorization,
  markAuthorizationState,
  runSpotPreflight,
  validateSpotPolicy,
  verifySpotEpisode,
  type BinanceExecutionEvidence,
  type BinanceSpotOrderIntent,
} from "@lujaw-binance/core";
import type { Hex } from "viem";
import { DEMO_SPOT_CEILINGS } from "./demo-preset.js";
import { coerceObservation } from "./normalize.js";
import {
  loadActivePolicy,
  loadAuthorization,
  loadDraftPolicy,
  loadOrInitLedger,
  loadPreflight,
  isPreflightConsumed,
  markPreflightConsumed,
  reconcileLedger,
  releaseReservation,
  reserveAuthorization,
  reservedTotal,
  saveAuthorization,
  savePreflight,
  saveSpotEpisode,
  consumeReservationToExecuted,
  writeActivePolicy,
  writeDraftPolicy,
} from "./state.js";
import {
  episodeVerifyToolArgsSchema,
  orderAuthorizeToolArgsSchema,
  orderPreflightToolArgsSchema,
  policyCreateToolArgsSchema,
} from "../tool-inputs.js";

export const binanceToolDefinitions = [
  {
    name: "lujaw_policy_create",
    description:
      "Draft or activate a deterministic Binance Spot safety policy (USDT-quoted allowlist). accept=true requires the exact displayed policyHash. Does not place trades.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["demo"] },
        accountRef: { type: "string" },
        maxOrderNotional: { type: "string" },
        minQuoteReserve: { type: "string" },
        maxDailyGrossNotional: { type: "string" },
        maxAssetConcentrationBps: { type: "number" },
        maxEstimatedSlippageBps: { type: "number" },
        accept: { type: "boolean" },
        policyHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_order_preflight",
    description:
      "Deterministically assess a proposed Binance Spot order using host-supplied normalized observations or raw fixture-shaped market/account/book data. Returns ALLOW, REDUCE, BLOCK, or INCONCLUSIVE with an exact preflightHash.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "object", additionalProperties: true },
        observation: { type: "object", additionalProperties: true },
      },
      required: ["intent", "observation"],
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_order_authorize",
    description:
      "Convert one unexpired ALLOW/REDUCE preflight into a one-shot authorization after accept=true with the exact preflightHash. Does not submit the order — Cursor must call Binance MCP with the exact authorized order, then lujaw_episode_verify.",
    inputSchema: {
      type: "object",
      properties: {
        preflightHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        accept: { type: "boolean" },
      },
      required: ["preflightHash", "accept"],
      additionalProperties: false,
    },
  },
  {
    name: "lujaw_episode_verify",
    description:
      "Build and verify a canonical Binance Spot episode from authorization plus host-supplied redacted Binance order/balance evidence. Host evidence is not cryptographically attested.",
    inputSchema: {
      type: "object",
      properties: {
        authorizationHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
        evidence: { type: "object", additionalProperties: true },
      },
      required: ["authorizationHash"],
      additionalProperties: false,
    },
  },
] as const;

export type BinanceToolContext = {
  stateDir: string;
};

export async function handleBinanceTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BinanceToolContext,
): Promise<unknown> {
  if (name === "lujaw_policy_create") {
    return cmdPolicyCreate(ctx, policyCreateToolArgsSchema.parse(args));
  }
  if (name === "lujaw_order_preflight") {
    return cmdOrderPreflight(ctx, orderPreflightToolArgsSchema.parse(args));
  }
  if (name === "lujaw_order_authorize") {
    return cmdOrderAuthorize(ctx, orderAuthorizeToolArgsSchema.parse(args));
  }
  if (name === "lujaw_episode_verify") {
    return cmdEpisodeVerify(ctx, episodeVerifyToolArgsSchema.parse(args));
  }
  return { ok: false, error: `unknown binance tool ${name}` };
}

function cmdPolicyCreate(
  ctx: BinanceToolContext,
  args: ReturnType<typeof policyCreateToolArgsSchema.parse>,
) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (args.accept === true) {
    const draft = loadDraftPolicy(ctx.stateDir);
    if (!draft) {
      return { ok: false, error: "no drafted policy; call with accept=false first" };
    }
    if (!args.policyHash || args.policyHash.toLowerCase() !== draft.policyHash.toLowerCase()) {
      return { ok: false, error: "policyHash does not match drafted policy" };
    }
    writeActivePolicy(ctx.stateDir, draft);
    return {
      ok: true,
      state: "ACTIVE",
      policy: draft.policy,
      policyHash: draft.policyHash,
      disclosures: [
        "Policy active for LUJAW-guided Spot workflow only.",
        "Host can still bypass LUJAW and call Binance MCP directly.",
      ],
    };
  }

  const accountRef = args.accountRef ?? "agentic-subaccount-redacted";
  const validated = validateSpotPolicy(
    {
      accountRef,
      preset: args.preset ?? "demo",
      maxOrderNotional: args.maxOrderNotional ?? DEMO_SPOT_CEILINGS.maxOrderNotional,
      minQuoteReserve: args.minQuoteReserve ?? DEMO_SPOT_CEILINGS.minQuoteReserve,
      maxDailyGrossNotional:
        args.maxDailyGrossNotional ?? DEMO_SPOT_CEILINGS.maxDailyGrossNotional,
      maxAssetConcentrationBps:
        args.maxAssetConcentrationBps ?? DEMO_SPOT_CEILINGS.maxAssetConcentrationBps,
      maxEstimatedSlippageBps:
        args.maxEstimatedSlippageBps ?? DEMO_SPOT_CEILINGS.maxEstimatedSlippageBps,
      feeBufferBps: DEMO_SPOT_CEILINGS.feeBufferBps,
      minValuationCoverageBps: DEMO_SPOT_CEILINGS.minValuationCoverageBps,
      authorizationTtlSeconds: DEMO_SPOT_CEILINGS.authorizationTtlSeconds,
      allowedSymbols: [...DEMO_SPOT_CEILINGS.allowedSymbols],
    },
    nowSeconds,
  );
  if (!validated.ok) {
    return { ok: false, error: validated.message, disclosures: validated.disclosures };
  }
  writeDraftPolicy(ctx.stateDir, {
    status: "DRAFTED",
    policy: validated.policy,
    policyHash: validated.policyHash,
  });
  return {
    ok: true,
    state: "DRAFTED",
    policy: validated.policy,
    policyHash: validated.policyHash,
    disclosures: validated.disclosures,
    next: "Re-call with accept=true and this exact policyHash to activate.",
  };
}

function cmdOrderPreflight(
  ctx: BinanceToolContext,
  args: ReturnType<typeof orderPreflightToolArgsSchema.parse>,
) {
  const active = loadActivePolicy(ctx.stateDir);
  if (!active || active.status !== "ACTIVE") {
    return { ok: false, error: "POLICY_MISSING", reasons: ["POLICY_MISSING"] };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ledger = reconcileLedger(loadOrInitLedger(ctx.stateDir, nowSeconds), nowSeconds);
  const observation = coerceObservation(args.observation, {
    executed: ledger.executedGrossNotional,
    reserved: reservedTotal(ledger),
  });
  const intent = args.intent as BinanceSpotOrderIntent;
  const preflight = runSpotPreflight({
    policy: active.policy,
    observation,
    intent,
  });
  savePreflight(ctx.stateDir, preflight);
  return {
    ok: true,
    preflight,
    bindingNote:
      preflight.decision === "REDUCE"
        ? "Authorized size is the deterministic maximum; do not pick a value between requested and authorized."
        : undefined,
  };
}

function cmdOrderAuthorize(
  ctx: BinanceToolContext,
  args: ReturnType<typeof orderAuthorizeToolArgsSchema.parse>,
) {
  if (args.accept !== true) {
    return { ok: false, error: "accept must be true to authorize" };
  }
  const active = loadActivePolicy(ctx.stateDir);
  if (!active) return { ok: false, error: "POLICY_MISSING" };
  const preflight = loadPreflight(ctx.stateDir, args.preflightHash);
  if (!preflight) return { ok: false, error: "unknown preflightHash" };
  if (isPreflightConsumed(ctx.stateDir, args.preflightHash)) {
    return { ok: false, reasons: ["AUTHORIZATION_REPLAY"], error: "preflight already consumed" };
  }

  const authResult = createSpotAuthorization({
    policy: active.policy,
    preflight,
    acceptedPreflightHash: args.preflightHash as Hex,
  });
  if (!authResult.ok) {
    return { ok: false, reasons: authResult.reasons, error: authResult.message };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  try {
    reserveAuthorization(ctx.stateDir, authResult.authorization, nowSeconds);
    markPreflightConsumed(ctx.stateDir, args.preflightHash);
  } catch (error) {
    return {
      ok: false,
      reasons: ["AUTHORIZATION_REPLAY"],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    authorization: authResult.authorization,
    authorizationHash: authResult.authorization.authorizationHash,
    binanceHandoff:
      "Call Binance MCP Spot order placement with exactly this authorizedOrder. Do not change symbol, side, type, or size. Binance will request its own confirmation. Then query order status and balances and call lujaw_episode_verify.",
    disclosure:
      "LUJAW has not submitted an order. Authorization is one-shot and expires quickly.",
  };
}

function cmdEpisodeVerify(
  ctx: BinanceToolContext,
  args: ReturnType<typeof episodeVerifyToolArgsSchema.parse>,
) {
  const auth = loadAuthorization(ctx.stateDir, args.authorizationHash);
  if (!auth) return { ok: false, error: "unknown authorizationHash" };
  if (auth.state !== "RESERVED" && auth.state !== "REPORTED") {
    return { ok: false, error: "AUTHORIZATION_REPLAY", reasons: ["AUTHORIZATION_REPLAY"] };
  }

  const preflight = loadPreflight(ctx.stateDir, auth.preflightHash);
  if (!preflight) return { ok: false, error: "missing preflight for authorization" };

  const nowSeconds = Math.floor(Date.now() / 1000);
  let evidence: BinanceExecutionEvidence | null = null;
  if (args.evidence) {
    evidence = {
      ...(args.evidence as BinanceExecutionEvidence),
      hostAttested: false,
    };
  }

  let nextAuth = markAuthorizationState(auth, "REPORTED");
  if (evidence?.status === "FILLED") {
    nextAuth = markAuthorizationState(nextAuth, "VERIFIED");
    consumeReservationToExecuted(
      ctx.stateDir,
      auth.authorizationHash,
      evidence.cumulativeQuoteQty || auth.reservedNotional,
      nowSeconds,
    );
  } else if (
    evidence?.status === "REJECTED" ||
    evidence?.status === "CANCELED" ||
    evidence?.status === "EXPIRED"
  ) {
    nextAuth = markAuthorizationState(nextAuth, "FAILED");
    releaseReservation(ctx.stateDir, auth.authorizationHash, nowSeconds);
  }
  saveAuthorization(ctx.stateDir, nextAuth);

  const episode = buildSpotEpisode({
    createdAt: nowSeconds,
    policyHash: auth.policyHash as Hex,
    observationHash: preflight.observationHash as Hex,
    preflight,
    authorization: nextAuth,
    exactHashAccepted: true,
    evidence,
  });
  const path = saveSpotEpisode(ctx.stateDir, episode);
  const verified = verifySpotEpisode(episode);
  return {
    ok: verified.ok,
    episode,
    path,
    verifyErrors: verified.errors,
    limitations: episode.limitations,
  };
}
