/**
 * Shared agent runtime: env, deployment, clients, in-memory live session.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAltanaAdapter,
  loadActiveState,
  loadDeployment,
  runActivate,
  runCheck,
  runRescue,
  runRevoke,
  type ActiveState,
  type DeploymentProfile,
  type DraftCarePlanInput,
} from "@lujaw/core";
import { createPublicClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

export function defaultDeploymentPath(): string {
  return (
    process.env.LUJAW_DEPLOYMENT_PATH ??
    join(repoRoot, "deployments", "bsc-testnet.json")
  );
}

export function defaultStateDir(): string {
  return process.env.LUJAW_STATE_DIR ?? join(here, "..", "state");
}

export function defaultStatePath(): string {
  return join(defaultStateDir(), "active.json");
}

export function defaultEpisodesDir(): string {
  return join(defaultStateDir(), "episodes");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function normalizePrivateKey(raw: string): Hex {
  const value = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("private key must be 32-byte hex");
  }
  return value as Hex;
}

export type AgentRuntime = {
  deployment: DeploymentProfile;
  client: PublicClient;
  adapter: ReturnType<typeof createAltanaAdapter>;
  account: Address;
  statePath: string;
  episodesDir: string;
  /** Secret-bearing session held only by this process. */
  liveSession: Awaited<ReturnType<ReturnType<typeof createAltanaAdapter>["grantSession"]>>["session"] | null;
};

export function createRuntime(options: {
  deploymentPath?: string;
  statePath?: string;
  episodesDir?: string;
  account?: Address;
  requireOwner?: boolean;
} = {}): AgentRuntime {
  const deployment = loadDeployment(options.deploymentPath ?? defaultDeploymentPath());
  const rpcUrl = requireEnv(deployment.rpcEnvVar);
  const ownerRaw = process.env.OWNER_PRIVATE_KEY?.trim();
  const ownerKey = ownerRaw ? normalizePrivateKey(ownerRaw) : undefined;
  if (options.requireOwner && ownerKey === undefined) {
    throw new Error("OWNER_PRIVATE_KEY is required for activate/revoke");
  }
  const owner = ownerKey ? privateKeyToAccount(ownerKey) : null;
  const configuredAccount = options.account ??
    (process.env.LUJAW_ACCOUNT as Address | undefined) ??
    owner?.address;
  if (!configuredAccount) {
    throw new Error("an account is required: pass --account or set LUJAW_ACCOUNT");
  }
  const client = createPublicClient({
    chain: bscTestnet,
    transport: http(rpcUrl),
  }) as PublicClient;
  const adapter = createAltanaAdapter({
    rpcUrl,
    ...(ownerKey ? { ownerPrivateKey: ownerKey } : {}),
    publicClient: client,
    deployment,
  });
  return {
    deployment,
    client,
    adapter,
    account: configuredAccount,
    statePath: options.statePath ?? defaultStatePath(),
    episodesDir: options.episodesDir ?? defaultEpisodesDir(),
    liveSession: null,
  };
}

export async function cmdCheck(
  runtime: AgentRuntime,
  options: { planFromState?: boolean } = {},
) {
  let plan = null;
  if (options.planFromState !== false) {
    try {
      plan = loadActiveState(runtime.statePath, runtime.deployment, runtime.account).plan;
    } catch {
      plan = null;
    }
  }
  return runCheck({
    client: runtime.client,
    deployment: runtime.deployment,
    account: runtime.account,
    plan,
    episodesDir: runtime.episodesDir,
  });
}

export async function cmdActivate(
  runtime: AgentRuntime,
  input: {
    draft: DraftCarePlanInput;
    accept: boolean;
    acceptedPlanHash?: Hex;
    sessionPrivateKey?: Hex;
    allowEphemeralSession?: boolean;
  },
) {
  const draft = {
    ...input.draft,
    ...(process.env.AGENT_ROUTER_API_KEY
      ? { agentRouterApiKey: process.env.AGENT_ROUTER_API_KEY }
      : {}),
    ...(process.env.AGENT_ROUTER_BASE_URL
      ? { agentRouterBaseUrl: process.env.AGENT_ROUTER_BASE_URL }
      : {}),
    ...(process.env.AGENT_ROUTER_MODEL
      ? { agentRouterModel: process.env.AGENT_ROUTER_MODEL }
      : {}),
  };
  // The CLI keeps this key in the caller's external environment; MCP may omit
  // it and retain a freshly generated signer only for the server process.
  const envSession = process.env.SESSION_PRIVATE_KEY;
  const sessionPrivateKey =
    input.sessionPrivateKey ??
    (envSession
      ? ((envSession.startsWith("0x") ? envSession : `0x${envSession}`) as Hex)
      : undefined);
  if (input.accept && input.allowEphemeralSession === false && sessionPrivateKey === undefined) {
    return {
      ok: false as const,
      message: "accepted CLI activation requires a fresh SESSION_PRIVATE_KEY in the external environment",
    };
  }
  const result = await runActivate({
    client: runtime.client,
    deployment: runtime.deployment,
    adapter: runtime.adapter,
    account: runtime.account,
    draft,
    accept: input.accept,
    ...(input.acceptedPlanHash ? { acceptedPlanHash: input.acceptedPlanHash } : {}),
    statePath: runtime.statePath,
    ...(sessionPrivateKey ? { sessionPrivateKey } : {}),
    onSession: (session) => {
      runtime.liveSession = session;
    },
  });
  return result;
}

export async function cmdRescue(runtime: AgentRuntime) {
  const state = loadActiveState(runtime.statePath, runtime.deployment, runtime.account) as ActiveState;
  if (runtime.liveSession === null) {
    const raw = process.env.SESSION_PRIVATE_KEY?.trim();
    if (raw) runtime.liveSession = runtime.adapter.restoreSession(state.sessionRecord, normalizePrivateKey(raw));
  }
  return runRescue({
    client: runtime.client,
    deployment: runtime.deployment,
    adapter: runtime.adapter,
    account: runtime.account,
    state,
    statePath: runtime.statePath,
    episodesDir: runtime.episodesDir,
    ...(runtime.liveSession ? { liveSession: runtime.liveSession } : {}),
  });
}

export async function cmdRevoke(runtime: AgentRuntime) {
  const state = loadActiveState(runtime.statePath, runtime.deployment, runtime.account);
  const result = await runRevoke({
    adapter: runtime.adapter,
    account: runtime.account,
    deployment: runtime.deployment,
    state,
    statePath: runtime.statePath,
  });
  if (result.ok) {
    runtime.liveSession = null;
  }
  return result;
}
