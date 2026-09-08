#!/usr/bin/env tsx
/**
 * lujaw CLI — thin wrapper over shared orchestration.
 *
 * Exit codes:
 *   0 success / held
 *   1 usage / draft / validation failure
 *   2 on-chain / execution failure
 */
import {
  cmdActivate,
  cmdCheck,
  cmdRescue,
  cmdRevoke,
  createRuntime,
} from "./runtime.js";
import { episodeExitCode } from "./tool-inputs.js";

function usage(): string {
  return `Usage:
  lujaw check [--json] [--account 0x...]
  lujaw activate --preset conservative|balanced [--accept <plan-hash>] [--json]
  lujaw activate --nl "..." [--accept <plan-hash>] [--json]
  lujaw rescue [--json]
  lujaw revoke [--json]

Environment: BSC_TESTNET_RPC_URL; LUJAW_ACCOUNT for read-only check without owner key
Mutating commands: OWNER_PRIVATE_KEY for activate/revoke; SESSION_PRIVATE_KEY for accepted CLI activate/rescue
Optional: AGENT_ROUTER_API_KEY, AGENT_ROUTER_BASE_URL, AGENT_ROUTER_MODEL, LUJAW_STATE_DIR
Session keys: use a fresh externally-held SESSION_PRIVATE_KEY for each CLI activation.
`;
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  const command = args.shift();
  const flags = new Map<string, string | true>();
  while (args.length > 0) {
    const token = args.shift()!;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = args[0];
      if (next && !next.startsWith("--")) {
        flags.set(key, args.shift()!);
      } else {
        flags.set(key, true);
      }
    }
  }
  return { command, flags };
}

function print(result: unknown, asJson: boolean, human?: string): void {
  if (asJson) {
    console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString(10) : v), 2));
  } else if (human) {
    console.log(human);
  } else {
    console.log(String(result));
  }
}

async function main(): Promise<number> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === "help" || flags.has("help")) {
    console.log(usage());
    return command ? 0 : 1;
  }

  const asJson = flags.has("json");
  const account = flags.get("account");
  try {
    const runtime = createRuntime({
      ...(typeof account === "string" ? { account: account as `0x${string}` } : {}),
      requireOwner:
        command === "revoke" ||
        (command === "activate" && typeof flags.get("accept") === "string"),
    });
    if (command === "check") {
      const result = await cmdCheck(runtime);
      print(
        { episode: result.episode, path: result.path },
        asJson,
        result.human,
      );
      return episodeExitCode(result.episode.outcome);
    }

    if (command === "activate") {
      const preset = flags.get("preset");
      const nl = flags.get("nl");
      const acceptArg = flags.get("accept");
      if (acceptArg === true) {
        console.error("--accept requires the exact displayed plan hash");
        return 1;
      }
      if (flags.has("session-key")) {
        console.error("do not pass session keys on the command line; use the external SESSION_PRIVATE_KEY environment");
        return 1;
      }
      const accept = typeof acceptArg === "string";
      if (typeof preset !== "string" && typeof nl !== "string") {
        console.error("activate requires --preset or --nl");
        return 1;
      }
      const result = await cmdActivate(runtime, {
        draft: {
          ...(typeof preset === "string"
            ? { preset: preset as "conservative" | "balanced" | "custom" }
            : {}),
          ...(typeof nl === "string" ? { naturalLanguage: nl } : {}),
        },
        accept,
        ...(typeof acceptArg === "string" ? { acceptedPlanHash: acceptArg as `0x${string}` } : {}),
        allowEphemeralSession: false,
      });
      print(result, asJson, result.message);
      if (result.ok) return 0;
      return 1;
    }

    if (command === "rescue") {
      const result = await cmdRescue(runtime);
      print(
        { episode: result.episode, path: result.path },
        asJson,
        result.human,
      );
      return episodeExitCode(result.episode.outcome);
    }

    if (command === "revoke") {
      const result = await cmdRevoke(runtime);
      print(result, asJson, result.message);
      return result.ok ? 0 : 2;
    }

    console.error(usage());
    return 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(message);
    }
    return 1;
  }
}

const code = await main();
process.exit(code);
