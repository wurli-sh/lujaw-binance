/**
 * Atomic local state for Binance Spot policy, authorizations, and daily ledger.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type BinanceSpotAuthorization,
  type BinanceSpotEpisode,
  type BinanceSpotPolicy,
  type BinanceSpotPreflight,
  addScaled,
  formatScaled,
  parseScaled,
  subScaled,
} from "@lujaw/core";
import type { Hex } from "viem";

export type SpotPolicyState = {
  status: "DRAFTED" | "ACTIVE";
  policy: BinanceSpotPolicy;
  policyHash: Hex;
};

export type DailyLedger = {
  day: string;
  executedGrossNotional: string;
  reserved: Record<string, { notional: string; expiresAt: number }>;
};

function atomicWrite(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function binanceStateRoot(stateDir: string): string {
  return join(stateDir, "binance");
}

export function activePolicyPath(stateDir: string): string {
  return join(binanceStateRoot(stateDir), "active-policy.json");
}

export function draftPolicyPath(stateDir: string): string {
  return join(binanceStateRoot(stateDir), "active-policy.draft.json");
}

export function authorizationsDir(stateDir: string): string {
  return join(binanceStateRoot(stateDir), "authorizations");
}

export function dailyLedgerDir(stateDir: string): string {
  return join(binanceStateRoot(stateDir), "daily-ledger");
}

export function spotEpisodesDir(stateDir: string): string {
  return join(binanceStateRoot(stateDir), "episodes");
}

export function utcDay(nowSeconds: number): string {
  return new Date(nowSeconds * 1000).toISOString().slice(0, 10);
}

export function ledgerPath(stateDir: string, day: string): string {
  return join(dailyLedgerDir(stateDir), `${day}.json`);
}

export function writeDraftPolicy(stateDir: string, state: SpotPolicyState): void {
  atomicWrite(draftPolicyPath(stateDir), state);
}

export function writeActivePolicy(stateDir: string, state: SpotPolicyState): void {
  atomicWrite(activePolicyPath(stateDir), { ...state, status: "ACTIVE" });
}

export function loadActivePolicy(stateDir: string): SpotPolicyState | null {
  const path = activePolicyPath(stateDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SpotPolicyState;
}

export function loadDraftPolicy(stateDir: string): SpotPolicyState | null {
  const path = draftPolicyPath(stateDir);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SpotPolicyState;
}

export function loadOrInitLedger(stateDir: string, nowSeconds: number): DailyLedger {
  const day = utcDay(nowSeconds);
  const path = ledgerPath(stateDir, day);
  if (!existsSync(path)) {
    return { day, executedGrossNotional: "0", reserved: {} };
  }
  return JSON.parse(readFileSync(path, "utf8")) as DailyLedger;
}

export function reconcileLedger(ledger: DailyLedger, nowSeconds: number): DailyLedger {
  const reserved: DailyLedger["reserved"] = {};
  for (const [hash, entry] of Object.entries(ledger.reserved)) {
    if (entry.expiresAt > nowSeconds) {
      reserved[hash] = entry;
    }
  }
  return { ...ledger, reserved };
}

export function reservedTotal(ledger: DailyLedger): string {
  let total = 0n;
  for (const entry of Object.values(ledger.reserved)) {
    total = addScaled(total, parseScaled(entry.notional));
  }
  return formatScaled(total);
}

export function saveLedger(stateDir: string, ledger: DailyLedger): void {
  atomicWrite(ledgerPath(stateDir, ledger.day), ledger);
}

export function reserveAuthorization(
  stateDir: string,
  auth: BinanceSpotAuthorization,
  nowSeconds: number,
): DailyLedger {
  const ledger = reconcileLedger(loadOrInitLedger(stateDir, nowSeconds), nowSeconds);
  if (ledger.reserved[auth.authorizationHash]) {
    throw new Error("authorization already reserved");
  }
  ledger.reserved[auth.authorizationHash] = {
    notional: auth.reservedNotional,
    expiresAt: auth.expiresAt,
  };
  saveLedger(stateDir, ledger);
  atomicWrite(join(authorizationsDir(stateDir), `${auth.authorizationHash}.json`), auth);
  return ledger;
}

export function loadAuthorization(
  stateDir: string,
  authorizationHash: string,
): BinanceSpotAuthorization | null {
  const path = join(authorizationsDir(stateDir), `${authorizationHash}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as BinanceSpotAuthorization;
}

export function saveAuthorization(stateDir: string, auth: BinanceSpotAuthorization): void {
  atomicWrite(join(authorizationsDir(stateDir), `${auth.authorizationHash}.json`), auth);
}

export function consumeReservationToExecuted(
  stateDir: string,
  authorizationHash: string,
  executedNotional: string,
  nowSeconds: number,
): void {
  const ledger = reconcileLedger(loadOrInitLedger(stateDir, nowSeconds), nowSeconds);
  const reserved = ledger.reserved[authorizationHash];
  if (reserved) {
    delete ledger.reserved[authorizationHash];
    const unused = parseScaled(reserved.notional) > parseScaled(executedNotional)
      ? subScaled(parseScaled(reserved.notional), parseScaled(executedNotional))
      : 0n;
    void unused;
  }
  ledger.executedGrossNotional = formatScaled(
    addScaled(parseScaled(ledger.executedGrossNotional), parseScaled(executedNotional)),
  );
  saveLedger(stateDir, ledger);
}

export function releaseReservation(
  stateDir: string,
  authorizationHash: string,
  nowSeconds: number,
): void {
  const ledger = reconcileLedger(loadOrInitLedger(stateDir, nowSeconds), nowSeconds);
  delete ledger.reserved[authorizationHash];
  saveLedger(stateDir, ledger);
}

export function saveSpotEpisode(stateDir: string, episode: BinanceSpotEpisode): string {
  const path = join(spotEpisodesDir(stateDir), `${episode.episodeId}.json`);
  atomicWrite(path, episode);
  return path;
}

export function savePreflight(stateDir: string, preflight: BinanceSpotPreflight): void {
  atomicWrite(
    join(binanceStateRoot(stateDir), "preflights", `${preflight.preflightHash}.json`),
    preflight,
  );
}

export function loadPreflight(
  stateDir: string,
  preflightHash: string,
): BinanceSpotPreflight | null {
  const path = join(binanceStateRoot(stateDir), "preflights", `${preflightHash}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as BinanceSpotPreflight;
}

export function markPreflightConsumed(stateDir: string, preflightHash: string): void {
  const marker = join(binanceStateRoot(stateDir), "preflights", `${preflightHash}.consumed`);
  atomicWrite(marker, { consumedAt: Math.floor(Date.now() / 1000) });
}

export function isPreflightConsumed(stateDir: string, preflightHash: string): boolean {
  return existsSync(
    join(binanceStateRoot(stateDir), "preflights", `${preflightHash}.consumed`),
  );
}
