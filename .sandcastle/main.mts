// Parallel-planner-with-review — plan, fan out implement→review, then merge.
//
// Adapted from sandcastle's own self-driving config at sandcastle/.sandcastle/run.ts.
//
//   Phase 1 (Plan):    An orchestrator agent reads open issues, builds a dependency
//                      graph, and emits a <plan> tag with up to N parallelizable
//                      branches.
//   Phase 2 (Execute): Up to MAX_PARALLEL sandboxes run concurrently. Each one runs
//                      an implementer; if it produced commits, a reviewer runs on
//                      the same branch.
//   Phase 3 (Merge):   One agent merges every completed branch into the current
//                      branch and closes the corresponding issues.
//
// Usage:
//   npx tsx .sandcastle/main.mts

import { execFile as execFileCb } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import * as sandcastle from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const execFile = promisify(execFileCb);

const MODEL = "gpt-5.6-sol";
const MAX_ITERATIONS = 10;
const MAX_PARALLEL = 4;
const IDLE_TIMEOUT_SECONDS = 1800;
const NPM_CACHE_DIR = "~/.npm";
const CARGO_REGISTRY_DIR = "~/.cargo/registry";
const CARGO_GIT_DIR = "~/.cargo/git";
const HOST_CODEX_AUTH_FILE = "~/.codex/auth.json";
const HOST_CODEX_AGENTS_FILE = "~/.codex/AGENTS.md";
// Container codex home is assembled from three file mounts (auth, config,
// optional global AGENTS.md). The parent /home/agent/.codex dir is
// auto-created by the sandcastle docker provider (≥0.7.0) and owned by the
// agent user, so codex can still write its own state/sessions/sqlite inside
// the container — that state is ephemeral and dies with the container,
// which is exactly what we want for isolation. Nothing from the host's
// real ~/.codex (MCP servers, hooks, shell snapshots, sqlite, …) leaks in.
const SANDBOX_CODEX_CONFIG = ".sandcastle/codex-container.toml";
// Sandcastle calls `git config --global --add safe.directory <path>` for
// every host-side worktree. Without redirection that pollutes ~/.gitconfig
// with one stale entry per run. We point GIT_CONFIG_GLOBAL at a throwaway
// file that just `[include]`s the real ~/.gitconfig — reads still resolve
// host identity, but the `--global --add` writes land in the throwaway.
const SANDBOX_GITCONFIG = ".sandcastle/.gitconfig";
const expandHome = (path: string) =>
  path.replace(/^~/, process.env.HOME ?? "");

await mkdir(expandHome(NPM_CACHE_DIR), { recursive: true });
await mkdir(expandHome(CARGO_REGISTRY_DIR), { recursive: true });
await mkdir(expandHome(CARGO_GIT_DIR), { recursive: true });
try {
  await access(expandHome(HOST_CODEX_AUTH_FILE));
} catch {
  throw new Error(
    `Codex auth not found at ${HOST_CODEX_AUTH_FILE}. Run "codex login" on the host before starting Sandcastle.`,
  );
}
const hasHostCodexAgents = await access(expandHome(HOST_CODEX_AGENTS_FILE))
  .then(() => true, () => false);

await writeFile(SANDBOX_GITCONFIG, "[include]\n\tpath = ~/.gitconfig\n");
process.env.GIT_CONFIG_GLOBAL = resolve(SANDBOX_GITCONFIG);

const dockerSandbox = docker({
  mounts: [
    { hostPath: NPM_CACHE_DIR, sandboxPath: NPM_CACHE_DIR },
    { hostPath: CARGO_REGISTRY_DIR, sandboxPath: CARGO_REGISTRY_DIR },
    { hostPath: CARGO_GIT_DIR, sandboxPath: CARGO_GIT_DIR },
    {
      hostPath: HOST_CODEX_AUTH_FILE,
      sandboxPath: "/home/agent/.codex/auth.json",
    },
    {
      hostPath: SANDBOX_CODEX_CONFIG,
      sandboxPath: "/home/agent/.codex/config.toml",
    },
    ...(hasHostCodexAgents
      ? [
          {
            hostPath: HOST_CODEX_AGENTS_FILE,
            sandboxPath: "/home/agent/.codex/AGENTS.md",
          },
        ]
      : []),
  ],
});

// True if `branch` has commits not yet on `main`. Used to decide whether a
// branch is worth handing to the merger — covers both "implementer made
// commits this iteration" and "fix was already on the branch from a prior
// iteration whose merger never picked it up" (issue: deterministic skip of
// stalled-but-ready branches).
async function branchIsAheadOfMain(branch: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", [
      "rev-list",
      "--count",
      `main..${branch}`,
    ]);
    return parseInt(stdout.trim(), 10) > 0;
  } catch (err) {
    console.warn(`  ⚠ couldn't check ${branch} ahead-of-main: ${err}`);
    return false;
  }
}

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // Phase 1: Plan
  const plan = await sandcastle.run({
    sandbox: dockerSandbox,
    name: "Planner",
    agent: sandcastle.codex(MODEL, { effort: "high" }),
    promptFile: "./.sandcastle/plan-prompt.md",
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
  });

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error(
      "Orchestrator did not produce a <plan> tag.\n\n" + plan.stdout,
    );
  }

  const { issues } = JSON.parse(planMatch[1]) as {
    issues: { number: number; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    console.log("No issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  #${issue.number}: ${issue.title} → ${issue.branch}`);
  }

  // Phase 2: Implement + Review, up to MAX_PARALLEL concurrent
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = () =>
    running < MAX_PARALLEL
      ? (running++, Promise.resolve())
      : new Promise<void>((resolve) => queue.push(resolve));
  const release = () => {
    running--;
    const next = queue.shift();
    if (next) {
      running++;
      next();
    }
  };

  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      await acquire();
      try {
        await using sandbox = await sandcastle.createSandbox({
          sandbox: dockerSandbox,
          branch: issue.branch,
          copyToWorktree: ["node_modules"],
          hooks: {
            sandbox: {
              // Use `npm ci` (not `npm install`) so the boot hook can't
              // silently rewrite package-lock.json based on the container's
              // platform (linux) vs the host's (macOS). Mutation here forces
              // the merger to repair the lockfile every iteration.
              onSandboxReady: [{ command: "npm ci" }],
            },
          },
        });

        const result = await sandbox.run({
          name: "Implementer #" + issue.number,
          agent: sandcastle.codex(MODEL, { effort: "high" }),
          promptFile: "./.sandcastle/implement-prompt.md",
          idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
          promptArgs: {
            ISSUE_NUMBER: String(issue.number),
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        if (result.commits.length > 0) {
          await sandbox.run({
            name: "Reviewer #" + issue.number,
            agent: sandcastle.codex(MODEL, { effort: "high" }),
            promptFile: "./.sandcastle/review-prompt.md",
            idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
            promptArgs: {
              ISSUE_NUMBER: String(issue.number),
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });
        }

        return result;
      } finally {
        release();
      }
    }),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ #${issues[i].number} (${issues[i].branch}) failed: ${outcome.reason}`,
      );
    }
  }

  const fulfilledIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i] }))
    .filter((entry) => entry.outcome.status === "fulfilled")
    .map((entry) => entry.issue);

  const aheadFlags = await Promise.all(
    fulfilledIssues.map((issue) => branchIsAheadOfMain(issue.branch)),
  );
  const completedIssues = fulfilledIssues.filter((_, i) => aheadFlags[i]);
  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) ahead of main:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No branches ahead of main. Nothing to merge.");
    continue;
  }

  // Phase 3: Merge
  await sandcastle.run({
    sandbox: dockerSandbox,
    name: "Merger",
    maxIterations: 10,
    agent: sandcastle.codex(MODEL, { effort: "high" }),
    promptFile: "./.sandcastle/merge-prompt.md",
    idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues
        .map((i) => `- #${i.number}: ${i.title}`)
        .join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
