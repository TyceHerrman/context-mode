/**
 * OpenCode / KiloCode TypeScript plugin entry point for context-mode.
 *
 * Provides three hooks:
 *   - tool.execute.before  — Routing enforcement (deny/modify/passthrough)
 *   - tool.execute.after   — Session event capture
 *   - experimental.session.compacting — Compaction snapshot generation
 *
 * KiloCode loads this via: import("context-mode") → expects default export
 * with shape { server: (input) => Promise<Hooks> } (PluginModule).
 *
 * OpenCode loads this via: import("context-mode/plugin") → also supports
 * the named export ContextModePlugin for backward compat.
 *
 * Constraints:
 *   - No SessionStart hook (OpenCode doesn't support it — #14808, #5409)
 *   - No context injection (canInjectSessionContext: false)
 *   - No routing file auto-write (avoid dirtying project trees)
 *   - Session cleanup happens at plugin init (no SessionStart)
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import { SessionDB } from "./session/db.js";
import { extractEvents } from "./session/extract.js";
import type { HookInput } from "./session/extract.js";
import { buildResumeSnapshot } from "./session/snapshot.js";
import type { SessionEvent } from "./types.js";
import { AdapterPlatformType, OpenCodeAdapter } from "./adapters/opencode/index.js";
import { PLATFORM_ENV_VARS } from "./adapters/detect.js";

// Read package.json version once at module load (not on every hook call).
// Used in the resume-injection visible signal so users can confirm in
// OPENCODE_DEBUG logs which plugin version actually injected.
const VERSION: string = (() => {
  try {
    const pkgRoot = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../package.json", "./package.json"]) {
      const p = resolve(pkgRoot, rel);
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")).version ?? "unknown";
    }
  } catch { /* fall through */ }
  return "unknown";
})();

// ── Types ─────────────────────────────────────────────────

/** KiloCode/OpenCode plugin input — both platforms pass at least `directory`. */
interface PluginContext {
  directory: string;
  [key: string]: unknown;
}

/** OpenCode tool.execute.before — first parameter */
interface BeforeHookInput {
  tool: string;
  sessionID: string;
  callID: string;
}

/** OpenCode tool.execute.before — second parameter */
interface BeforeHookOutput {
  args: any;
}

/** OpenCode tool.execute.after — first parameter */
interface AfterHookInput {
  tool: string;
  sessionID: string;
  callID: string;
  args: any;
}

/** OpenCode tool.execute.after — second parameter */
interface AfterHookOutput {
  title: string;
  output: string;
  metadata: any;
}

/** OpenCode experimental.session.compacting — first parameter */
interface CompactingHookInput {
  sessionID: string;
}

/** OpenCode experimental.session.compacting — second parameter */
interface CompactingHookOutput {
  context: string[];
  prompt?: string;
}

/**
 * OpenCode experimental.chat.system.transform — first parameter.
 * Verified against sst/opencode/dev/packages/plugin/src/index.ts:
 *   input: { sessionID?: string; model: Model }
 * `sessionID` is optional in the SDK type but is in practice always set
 * (the transform runs *for* a session). We treat it as required and
 * skip injection when absent rather than fall back to a fabricated ID.
 *
 * NOTE: We deliberately do NOT use `experimental.chat.messages.transform`.
 * Its SDK input shape is `{}` (no sessionID) and its output is
 * `{ messages: { info: Message; parts: Part[] }[] }` — the prior code
 * (`output.messages.unshift({ role, content })`) wrote a value of the
 * wrong shape and was silently dropped (Mickey / PR #376 root cause).
 */
interface SystemTransformHookInput {
  sessionID?: string;
  model: unknown;
}

/** OpenCode experimental.chat.system.transform — second parameter */
interface SystemTransformHookOutput {
  system: string[];
}

// ── Helpers ───────────────────────────────────────────────
/**
 * Detect whether the plugin is running under KiloCode or OpenCode.
 *
 * Reuses the canonical PLATFORM_ENV_VARS list (src/adapters/detect.ts) instead
 * of hardcoding env var names — single source of truth, future-proof if Kilo
 * or OpenCode add/rename env vars upstream.
 *
 * Order matters: KiloCode is an OpenCode fork and sets `OPENCODE=1` in
 * addition to `KILO_PID`. PLATFORM_ENV_VARS lists `kilo` BEFORE `opencode`
 * so KILO_PID wins the iteration.
 *
 * Pre-fix version was `return process.env.KILO_PID ? "kilo" : "opencode";` —
 * surfaced by github.com/mksglu/context-mode/pull/376 (mikij). Full symmetric
 * fix: also actively check opencode env vars instead of blind fallback.
 */
function getPlatform(): AdapterPlatformType {
  for (const [platform, vars] of PLATFORM_ENV_VARS) {
    if (platform !== "kilo" && platform !== "opencode") continue;
    if (vars.some((v) => process.env[v])) {
      return platform as AdapterPlatformType;
    }
  }
  // Plugin host should always set one of the env vars. Fallback to opencode
  // (the wider ecosystem) when neither is set, for predictable behavior.
  return "opencode";
}

// ── Plugin Factory ────────────────────────────────────────

/**
 * Plugin factory. Called once when KiloCode/OpenCode loads the plugin.
 * Returns an object mapping hook event names to async handler functions.
 *
 * KiloCode expects: export default { server: (input) => Promise<Hooks> }
 * OpenCode expects: export const ContextModePlugin = (ctx) => Promise<Hooks>
 */
async function createContextModePlugin(ctx: PluginContext) {
  // Resolve build dir from compiled JS location
  const adapter = new OpenCodeAdapter(getPlatform());
  const buildDir = dirname(fileURLToPath(import.meta.url));
  
  // Load routing module (ESM .mjs, lives outside build/ in hooks/)
  const routingPath = resolve(buildDir, "..", "hooks", "core", "routing.mjs");
  const routing = await import(pathToFileURL(routingPath).href);
  await routing.initSecurity(buildDir);
  
  // Initialize per-process state. We do NOT fabricate a sessionId here —
  // OpenCode/Kilo provide the real `input.sessionID` on every hook, and a
  // process-global UUID would (a) never match prior-session resume rows and
  // (b) collide across multi-session reuse (Mickey / PR #376 root cause).
  const projectDir = ctx.directory;
  const db = new SessionDB({ dbPath: adapter.getSessionDBPath(projectDir) });

  // Clean up old sessions on startup (no SessionStart hook to do this).
  db.cleanupOldSessions(7);

  // Track per-session resume injection: persistent plugin process can host
  // many sessions, so the gate must be keyed by sessionID — NOT a single
  // boolean closure flag (Mickey #2 root cause).
  const resumeInjected = new Set<string>();

  return {
    // ── PreToolUse: Routing enforcement ─────────────────

    "tool.execute.before": async (input: BeforeHookInput, output: BeforeHookOutput) => {
      const toolName = input.tool ?? "";
      const toolInput = output.args ?? {};

      let decision;
      try {
        decision = routing.routePreToolUse(toolName, toolInput, projectDir, getPlatform());
      } catch {
        return; // Routing failure → allow passthrough
      }

      if (!decision) return; // No routing match → passthrough

      if (decision.action === "deny" || decision.action === "ask") {
        // Throw to block — OpenCode catches this and denies the tool call
        throw new Error(decision.reason ?? "Blocked by context-mode");
      }

      if (decision.action === "modify" && decision.updatedInput) {
        // Mutate output.args — OpenCode reads the mutated output object
        Object.assign(output.args, decision.updatedInput);
      }

      // "context" action → no-op (OpenCode doesn't support context injection)
    },

    // ── PostToolUse: Session event capture ──────────────

    "tool.execute.after": async (input: AfterHookInput, output: AfterHookOutput) => {
      const sessionId = input.sessionID;
      if (!sessionId) return;
      try {
        db.ensureSession(sessionId, projectDir);
        const hookInput: HookInput = {
          tool_name: input.tool ?? "",
          tool_input: input.args ?? {},
          tool_response: output.output,
          tool_output: undefined, // OpenCode doesn't provide isError
        };

        const events = extractEvents(hookInput);
        for (const event of events) {
          // Cast: extract.ts SessionEvent lacks data_hash (computed by insertEvent)
          db.insertEvent(sessionId, event as SessionEvent, "PostToolUse");
        }
      } catch {
        // Silent — session capture must never break the tool call
      }
    },

    // ── PreCompact: Snapshot generation ─────────────────

    "experimental.session.compacting": async (input: CompactingHookInput, output: CompactingHookOutput) => {
      const sessionId = input.sessionID;
      if (!sessionId) return "";
      try {
        db.ensureSession(sessionId, projectDir);
        const events = db.getEvents(sessionId);
        if (events.length === 0) return "";

        const stats = db.getSessionStats(sessionId);
        const snapshot = buildResumeSnapshot(events, {
          compactCount: (stats?.compact_count ?? 0) + 1,
        });

        db.upsertResume(sessionId, snapshot, events.length);
        db.incrementCompactCount(sessionId);

        // Mutate output.context to inject the snapshot
        output.context.push(snapshot);

        return snapshot;
      } catch {
        return "";
      }
    },

    // ── SessionStart equivalent (PR #376) ───────────────
    // OpenCode lacks a real SessionStart hook (#14808, #5409). The closest
    // surrogate is `experimental.chat.system.transform` — verified shape:
    //   input:  { sessionID?: string; model: Model }
    //   output: { system: string[] }
    // We claim the most-recent unconsumed resume snapshot atomically (race-
    // safe across concurrent processes) and prepend it to the system prompt.
    // First-injection-per-session is enforced by `resumeInjected` Set.
    "experimental.chat.system.transform": async (
      input: SystemTransformHookInput,
      output: SystemTransformHookOutput,
    ) => {
      const sessionId = input?.sessionID;
      if (!sessionId) return;
      if (resumeInjected.has(sessionId)) return;
      try {
        // Pass current sessionId so SQL excludes self-injection (v1.0.106 — Mickey #376
        // follow-up): if Session B compacts mid-flight and produces its own row,
        // B's next system.transform must NOT claim that row back into B's prompt.
        const row = db.claimLatestUnconsumedResume(sessionId);
        if (!row || !row.snapshot) return;        // no row → leave `resumeInjected` unset → retry on next turn
        if (Array.isArray(output?.system)) {
          // Visible signal — without this, the injection is silent and users
          // cannot tell the feature is active (Mickey: "I can't find use case
          // for it"). The XML comment is harmless to the model and shows up in
          // OPENCODE_DEBUG logs as proof the snapshot landed.
          const eventCount = row.snapshot.match(/events="(\d+)"/)?.[1] ?? "?";
          const marker =
            `<!-- context-mode v${VERSION}: resumed prior session ${row.sessionId.slice(0, 8)} ` +
            `(${eventCount} events, ${row.snapshot.length} chars) -->\n`;

          // Insert at index 1 (after the header) — NOT unshift.
          // OpenCode's llm.ts:117-128 saves `header = system[0]` BEFORE this
          // hook runs and then folds the rest into a 2-part structure
          // `[header, body]` only if `system[0] === header` after the hook.
          // Prepending via unshift replaces system[0] with the snapshot,
          // making the equality check fail → cache-fold is skipped → every
          // system block is sent as a separate `role: "system"` message →
          // provider prompt cache is invalidated on every resume injection.
          // Inserting at index 1 keeps the header invariant and lets the
          // snapshot ride along inside the cached body block.
          output.system.splice(1, 0, marker + row.snapshot);
          // Mark consumed only AFTER successful splice so failed paths can retry
          resumeInjected.add(sessionId);
        }
      } catch {
        // Silent — never break the chat turn
      }
    },
  };
}

// ── Exports ──────────────────────────────────────────────
// KiloCode PluginModule: default export with { server } shape
// OpenCode compat: named export for direct import("context-mode/plugin")
export default { server: createContextModePlugin };
export { createContextModePlugin as ContextModePlugin };
