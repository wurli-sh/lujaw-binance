/**
 * Load and validate the frozen Phase 1 deployment profile.
 */
import { readFileSync } from "node:fs";
import { getAddress, isAddress, isHex } from "viem";
import type { Address, Hex } from "viem";
import { z } from "zod";

const addressSchema = z
  .string()
  .refine((value) => isAddress(value), { message: "invalid address" })
  .transform((value) => getAddress(value));

const selectorSchema = z
  .string()
  .refine((value) => isHex(value) && value.length === 10, { message: "invalid 4-byte selector" })
  .transform((value) => value.toLowerCase() as Hex);

const marketSchema = z.object({
  symbol: z.literal("USDT"),
  vToken: addressSchema,
  vTokenImplementation: addressSchema,
  underlying: addressSchema,
  underlyingDecimals: z.literal(6),
  supplyTarget: addressSchema,
  supplySelector: selectorSchema,
  supplySignature: z.literal("mint(uint256)"),
  approveSpender: addressSchema,
});

export const deploymentProfileSchema = z.object({
  version: z.literal("lujaw.deployment/1"),
  environment: z.string().min(1),
  chainId: z.literal(97),
  rpcEnvVar: z.string().min(1),
  explorer: z.object({
    address: z.string().min(1),
    tx: z.string().min(1),
  }),
  venus: z.object({
    comptroller: addressSchema,
    oracle: addressSchema,
    vaiController: addressSchema,
    vai: addressSchema,
    nativeVToken: addressSchema,
    market: marketSchema,
    failoverMarket: z
      .object({
        symbol: z.string(),
        vToken: addressSchema,
        underlying: addressSchema,
        underlyingDecimals: z.number().int().nonnegative(),
        note: z.string().optional(),
      })
      .optional(),
    accounting: z.object({
      oracleScaleRule: z.string(),
      liquidationThresholdSource: z.string(),
      vaiDebtSource: z.string(),
      debtUniverse: z.string(),
      collateralUniverse: z.string(),
    }),
  }),
  altana: z.object({
    sdkVersion: z.string(),
    relayUrl: z.string().url(),
    keyStore: addressSchema,
    keyStoreController: addressSchema,
    accountImplementation: addressSchema,
    orchestrator: addressSchema,
    feeToken: z.literal("NATIVE"),
    effectiveAuthority: z.object({
      readFrom: z.string(),
      criticalCodes: z.array(z.string()).min(1),
    }),
  }),
  verification: z.object({
    blockNumber: z.string(),
    provenance: z.array(z.record(z.unknown())),
    gate0FullPath: z.string(),
    gate0ObservePath: z.string().optional(),
  }),
});

export type DeploymentProfile = z.infer<typeof deploymentProfileSchema>;

export function loadDeployment(path: string): DeploymentProfile {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = deploymentProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid deployment profile at ${path}: ${parsed.error.message}`);
  }
  const profile = parsed.data;
  if (profile.verification.gate0FullPath !== "passed") {
    throw new Error(
      `deployment profile Gate 0 is not passed (gate0FullPath=${profile.verification.gate0FullPath})`,
    );
  }
  const market = profile.venus.market;
  if (market.supplyTarget.toLowerCase() !== market.vToken.toLowerCase()) {
    throw new Error("supplyTarget must equal vToken for the locked mint path");
  }
  if (market.approveSpender.toLowerCase() !== market.vToken.toLowerCase()) {
    throw new Error("approveSpender must equal vToken for the locked mint path");
  }
  if (market.supplySelector !== "0xa0712d68") {
    throw new Error(`unexpected supply selector ${market.supplySelector}`);
  }
  return profile;
}

export function explorerAddressUrl(profile: DeploymentProfile, address: string): string {
  return profile.explorer.address.replace("{address}", address);
}

export function explorerTxUrl(profile: DeploymentProfile, hash: string): string {
  return profile.explorer.tx.replace("{hash}", hash);
}

/** Narrow VenusDeployment shape used by observeAccount. */
export function venusDeploymentFromProfile(profile: DeploymentProfile) {
  const market = profile.venus.market;
  return {
    chainId: profile.chainId,
    comptroller: profile.venus.comptroller as Address,
    vToken: market.vToken as Address,
    vTokenImplementation: market.vTokenImplementation as Address,
    underlying: market.underlying as Address,
    underlyingSymbol: market.symbol,
    underlyingDecimals: market.underlyingDecimals,
    oracle: profile.venus.oracle as Address,
    vaiController: profile.venus.vaiController as Address,
    vai: profile.venus.vai as Address,
    nativeVToken: profile.venus.nativeVToken as Address,
  };
}
