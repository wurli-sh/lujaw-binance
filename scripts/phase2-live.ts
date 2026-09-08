#!/usr/bin/env tsx
/**
 * One-process Phase 2 live gate: check → activate(accept) → rescue → revoke.
 * Loads .env; never prints private keys.
 *
 * Default uses thresholds just above live HF so rescue can EXECUTE a small mint
 * (1 USDT cap). Set LUJAW_LIVE_PRESET=balanced to skip spend and only grant/hold/revoke.
 *
 *   pnpm phase2:live
 */
import {
  cmdActivate,
  cmdCheck,
  cmdRescue,
  cmdRevoke,
  createRuntime,
} from "../apps/agent/src/runtime.js";
import { generatePrivateKey } from "viem/accounts";

function summarizeEpisode(
  label: string,
  episode: {
    outcome: string;
    productStatus: string;
    calculation: { reason: string; topUpRaw: string };
    preState: { healthFactor: string | null };
    postState: { healthFactor: string | null; targetReached?: boolean } | null;
    transaction: { hash: string } | null;
    explorer?: { mintTx?: string | null; grantTx?: string | null };
  },
) {
  console.log(`\n=== ${label} ===`);
  console.log(
    `status=${episode.productStatus} outcome=${episode.outcome} reason=${episode.calculation.reason}`,
  );
  console.log(
    `preHF=${episode.preState.healthFactor} postHF=${episode.postState?.healthFactor ?? "n/a"} topUp=${episode.calculation.topUpRaw}`,
  );
  if (episode.transaction?.hash) console.log(`tx=${episode.transaction.hash}`);
  if (episode.explorer?.mintTx) console.log(`explorer=${episode.explorer.mintTx}`);
}

async function main(): Promise<void> {
  const runtime = createRuntime({ requireOwner: true });
  console.log(`account=${runtime.account}`);
  console.log(`market=${runtime.deployment.venus.market.symbol} chain=${runtime.deployment.chainId}`);

  // Clear any leftover live session from a prior interrupted run (owner-only revoke).
  try {
    const leftover = await cmdRevoke(runtime);
    console.log(`\n=== cleanup revoke ===\nok=${leftover.ok}`);
    if (leftover.revokeHash) console.log(`revokeTx=${leftover.revokeHash}`);
  } catch (error) {
    console.log(
      `\n=== cleanup revoke ===\nskipped (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const check = await cmdCheck(runtime);
  summarizeEpisode("check", check.episode);
  const hf = check.episode.preState.healthFactor;
  if (!hf) throw new Error("check returned null HF; cannot size live plan");

  const useBalanced = process.env.LUJAW_LIVE_PRESET === "balanced";
  const draft = useBalanced
    ? { preset: "balanced" as const }
    : {
        // Force AT_RISK just above live HF; small restore delta (~Gate 0: 1 USDT ≈ +0.05 HF).
        preset: "custom" as const,
        interveneBelow: bump(hf, 1),
        alertBelow: bump(hf, 6),
        restoreTo: bump(hf, 5),
        maxTopUpRaw: "2000000",
        sessionDurationSeconds: 3600,
      };

  console.log(`\n=== plan mode ===\n${useBalanced ? "balanced (hold expected)" : "custom above HF (execute expected)"}`);
  if (!useBalanced) {
    console.log(
      `intervene=${draft.interveneBelow} alert=${"alertBelow" in draft ? draft.alertBelow : ""} restore=${"restoreTo" in draft ? draft.restoreTo : ""}`,
    );
  }

  const preview = await cmdActivate(runtime, { draft, accept: false });
  if (!preview.ok || !preview.plan) {
    throw new Error(`draft failed: ${preview.message}`);
  }
  console.log(`\n=== activate draft ===\nmaxTopUp=${preview.plan.maxTopUpRaw} intervene=${preview.plan.interveneBelow}`);

  // Never reuse a revoked/env keyId — generate a fresh session signer for this grant.
  const sessionPrivateKey = generatePrivateKey();
  process.env.SESSION_PRIVATE_KEY = sessionPrivateKey;
  console.log("sessionKey=fresh (ephemeral for this process; not printed)");

  const activated = await cmdActivate(runtime, {
    draft,
    accept: true,
    acceptedPlanHash: preview.planHash!,
    sessionPrivateKey,
  });
  if (!activated.ok) {
    throw new Error(`activate failed: ${activated.message}`);
  }
  console.log(`\n=== activate accept ===\n${activated.message}`);
  console.log(`grantTx=${activated.sessionRecord?.grantTxHash ?? "n/a"}`);
  console.log(`liveSession=${runtime.liveSession ? "present" : "MISSING"}`);

  const rescue = await cmdRescue(runtime);
  summarizeEpisode("rescue", rescue.episode);

  const revoked = await cmdRevoke(runtime);
  console.log(`\n=== revoke ===\nok=${revoked.ok}`);
  console.log(revoked.message);
  if (revoked.revokeHash) console.log(`revokeTx=${revoked.revokeHash}`);
  console.log(`remainingAllowance=${revoked.remainingAllowance.toString(10)}`);

  if (!revoked.ok) process.exit(2);
  if (rescue.episode.outcome === "FAILED") process.exit(2);
  if (!useBalanced && rescue.episode.outcome !== "EXECUTED") {
    console.error(`expected EXECUTED for force-rescue plan, got ${rescue.episode.outcome}`);
    process.exit(2);
  }
  console.log("\nphase2-live: PASS");
}

/** Bump a decimal HF string by N hundredths (integer math). */
function bump(hf: string, hundredths: number): string {
  const [w, f = ""] = hf.split(".");
  const frac = `${f}${"0".repeat(Math.max(0, 2 - f.length))}`.slice(0, 2);
  const value = BigInt(w ?? "0") * 100n + BigInt(frac) + BigInt(hundredths);
  const whole = value / 100n;
  const rem = (value % 100n).toString(10).padStart(2, "0");
  return `${whole}.${rem}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
