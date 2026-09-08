/**
 * Observation freshness against chain head and pinned block hash.
 */
import type { PublicClient } from "viem";
import { MAX_OBSERVATION_AGE_BLOCKS } from "./constants.js";

export function isObservationFresh(
  observationBlock: bigint,
  headBlock: bigint,
  maxAgeBlocks: bigint = MAX_OBSERVATION_AGE_BLOCKS,
): boolean {
  if (headBlock < observationBlock) return false;
  return headBlock - observationBlock <= maxAgeBlocks;
}

/**
 * Re-read the observation block and require hash equality (reorg / pin mismatch).
 */
export async function isObservationPinValid(
  client: PublicClient,
  observation: { blockNumber: string; blockHash: string },
): Promise<boolean> {
  const block = await client.getBlock({ blockNumber: BigInt(observation.blockNumber) });
  if (!block.hash) return false;
  return block.hash.toLowerCase() === observation.blockHash.toLowerCase();
}

export async function assessObservationFreshness(
  client: PublicClient,
  observation: { blockNumber: string; blockHash: string },
  headBlock: bigint,
  maxAgeBlocks: bigint = MAX_OBSERVATION_AGE_BLOCKS,
): Promise<{ fresh: boolean; reason: "ok" | "age" | "hash_mismatch" }> {
  if (!isObservationFresh(BigInt(observation.blockNumber), headBlock, maxAgeBlocks)) {
    return { fresh: false, reason: "age" };
  }
  const pinOk = await isObservationPinValid(client, observation);
  if (!pinOk) return { fresh: false, reason: "hash_mismatch" };
  return { fresh: true, reason: "ok" };
}
