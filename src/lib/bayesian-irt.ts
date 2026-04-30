/**
 * Bayesian IRT subprocess bridge.
 *
 * Spawns `python3 scripts/bayesian_irt/fit.py`, pipes the observation
 * matrix over stdin, reads the posterior summary from stdout. Isolation
 * keeps the Node runtime stable even if NumPyro blows up — on any
 * failure the Node-side capability-scoring heuristic takes over.
 */

import { spawn } from "child_process";
import path from "path";

export type ArenaVerdict =
  | "LEFT_WINS"
  | "RIGHT_WINS"
  | "BOTH_GOOD"
  | "BOTH_BAD";

export interface IRTLikertObs {
  raterIdx: number;
  itemIdx: number;
  score: number; // 1..5
}

export interface IRTPairwiseObs {
  raterIdx: number;
  itemAIdx: number;
  itemBIdx: number;
  verdict: ArenaVerdict;
}

export interface IRTInput {
  raters: string[]; // userId per raterIdx
  items: string[]; // "<videoAssetId>:<dimensionId>" per itemIdx
  likertObs: IRTLikertObs[];
  pairwiseObs: IRTPairwiseObs[];
  /**
   * Ground truth map: itemIdx → expected Likert score 1..numCategories.
   * Anchors q_{i,d} to GT so α_r becomes "agreement with GT" rather than
   * "agreement with other raters".
   */
  groundTruth?: Record<number, number>;
  numCategories: number;
  numWarmup?: number;
  numSamples?: number;
  numChains?: number;
}

export interface IRTRaterPosterior {
  userId: string;
  alphaMean: number;
  alphaStd: number;
  alphaCILow: number;
  alphaCIHigh: number;
  rHat: number;
  ess: number;
  rankogramBins: number[];
}

export interface IRTResult {
  raters: IRTRaterPosterior[];
  globalDiagnostics: {
    rHatMax: number;
    rHatMean: number;
    divergentTransitions: number;
    numSamples: number;
    numChains: number;
    waic: number | null;
    gtAnchoredItems?: number;
    totalItems?: number;
  };
}

const DEFAULT_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "bayesian_irt",
  "fit.py",
);
const DEFAULT_PYTHON = process.env.BAYESIAN_IRT_PYTHON ?? "python3";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface FitOptions {
  timeoutMs?: number;
  scriptPath?: string;
  pythonBin?: string;
}

export class BayesianIRTError extends Error {
  constructor(
    message: string,
    public readonly reason:
      | "spawn-failed"
      | "timeout"
      | "nonzero-exit"
      | "bad-json"
      | "python-runtime",
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "BayesianIRTError";
  }
}

export async function fitBayesianIRT(
  input: IRTInput,
  options: FitOptions = {},
): Promise<IRTResult> {
  const scriptPath =
    options.scriptPath ??
    process.env.BAYESIAN_IRT_SCRIPT ??
    DEFAULT_SCRIPT;
  const pythonBin = options.pythonBin ?? DEFAULT_PYTHON;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<IRTResult>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(pythonBin, [scriptPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // NumPyro + JAX hot path; disable progress bars and telemetry.
          JAX_PLATFORMS: "cpu",
          XLA_FLAGS: "--xla_force_host_platform_device_count=4",
        },
      });
    } catch (err) {
      reject(
        new BayesianIRTError(
          "Failed to spawn python3",
          "spawn-failed",
          err instanceof Error ? err.message : String(err),
        ),
      );
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* best effort */
      }
      settle(() =>
        reject(
          new BayesianIRTError(
            `Python fit.py timed out after ${timeoutMs}ms`,
            "timeout",
            stderrBuf.slice(-400),
          ),
        ),
      );
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString("utf8");
    });
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });
    proc.on("error", (err) => {
      settle(() =>
        reject(
          new BayesianIRTError(
            "Python subprocess error",
            "spawn-failed",
            err.message,
          ),
        ),
      );
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        settle(() =>
          reject(
            new BayesianIRTError(
              `Python exited with code ${code}`,
              "nonzero-exit",
              stderrBuf.slice(-800) || stdoutBuf.slice(-400),
            ),
          ),
        );
        return;
      }
      // Python may print warnings before the JSON; take the last non-empty line.
      const lines = stdoutBuf
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const lastJson = lines[lines.length - 1] ?? "";
      let parsed: IRTResult;
      try {
        parsed = JSON.parse(lastJson) as IRTResult;
      } catch (err) {
        settle(() =>
          reject(
            new BayesianIRTError(
              "Could not parse JSON from fit.py stdout",
              "bad-json",
              (err instanceof Error ? err.message : String(err)) +
                " | last 300 chars: " +
                lastJson.slice(0, 300),
            ),
          ),
        );
        return;
      }
      settle(() => resolve(parsed));
    });

    try {
      proc.stdin.write(JSON.stringify(input));
      proc.stdin.end();
    } catch (err) {
      settle(() =>
        reject(
          new BayesianIRTError(
            "Failed to pipe stdin to python",
            "python-runtime",
            err instanceof Error ? err.message : String(err),
          ),
        ),
      );
    }
  });
}
