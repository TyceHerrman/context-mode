import "./setup-home";
/**
 * Tests for the OpenCode TypeScript plugin entry point.
 *
 * Tests the ContextModePlugin factory and its three hooks:
 *   - tool.execute.before (routing enforcement)
 *   - tool.execute.after (session event capture)
 *   - experimental.session.compacting (snapshot generation)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// ── Test helpers ──────────────────────────────────────────

/**
 * Create a plugin instance with DB in a temp directory.
 * Uses dynamic import to resolve routing module from project root.
 */
async function createTestPlugin(tempDir: string) {
  // Import the plugin module
  const { ContextModePlugin } = await import("../src/opencode-plugin.js");

  // Monkey-patch the session dir to use temp directory
  // The plugin uses homedir() internally, but we can control the DB path
  // by creating the plugin with a unique directory that produces a unique hash
  return ContextModePlugin({ directory: tempDir });
}

// ── Tests ─────────────────────────────────────────────────

// MCP readiness sentinel — routing.mjs checks process.ppid in-process
const _sentinelDir = process.platform === "win32" ? tmpdir() : "/tmp";
const mcpSentinel = resolve(_sentinelDir, `context-mode-mcp-ready-${process.pid}`);

beforeEach(() => { writeFileSync(mcpSentinel, String(process.pid)); });
afterEach(() => { try { unlinkSync(mcpSentinel); } catch {} });

describe("ContextModePlugin", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "opencode-plugin-test-"));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch { /* cleanup best effort */ }
  });

  // ── Factory ───────────────────────────────────────────

  describe("factory", () => {
    it("returns object with 4 hook handlers", async () => {
      const plugin = await createTestPlugin(join(tempDir, "factory-test"));

      expect(plugin).toHaveProperty("tool.execute.before");
      expect(plugin).toHaveProperty("tool.execute.after");
      expect(plugin).toHaveProperty("experimental.session.compacting");
      // SessionStart-equivalent (PR #376 / Mickey #1) — must be on
      // chat.system.transform, NOT chat.messages.transform (whose input
      // shape `{}` carries no sessionID and whose output {info,parts}[]
      // does not accept the {role,content} shape we used to push).
      expect(plugin).toHaveProperty("experimental.chat.system.transform");
      expect(plugin).not.toHaveProperty("experimental.chat.messages.transform");

      expect(typeof plugin["tool.execute.before"]).toBe("function");
      expect(typeof plugin["tool.execute.after"]).toBe("function");
      expect(typeof plugin["experimental.session.compacting"]).toBe("function");
      expect(typeof plugin["experimental.chat.system.transform"]).toBe("function");
    });

    it("does not write AGENTS.md routing instructions on startup", async () => {
      const projectDir = join(tempDir, "factory-startup-routing");
      mkdirSync(projectDir, { recursive: true });
      await createTestPlugin(projectDir);

      const agentsPath = join(projectDir, "AGENTS.md");
      expect(existsSync(agentsPath)).toBe(false);
    });
  });

  // ── tool.execute.before ───────────────────────────────

  describe("tool.execute.before", () => {
    it("modifies curl commands to block them", async () => {
      const plugin = await createTestPlugin(join(tempDir, "before-curl"));
      const input = { tool: "Bash", sessionID: "test-session", callID: "call-1" };
      const output = { args: { command: "curl https://example.com/data" } };

      // Routing should throw for blocked commands (deny action)
      // or modify the args to replace the command
      try {
        await plugin["tool.execute.before"](input, output);
        // If it didn't throw, the command was modified in output.args
        expect(output.args.command).toMatch(/^echo /);
        expect(output.args.command).toContain("context-mode");
      } catch (e: any) {
        // deny/ask action throws — still correct behavior
        expect(e.message).toContain("context-mode");
      }
    });

    it("modifies wget commands to block them", async () => {
      const plugin = await createTestPlugin(join(tempDir, "before-wget"));
      const input = { tool: "Bash", sessionID: "test-session", callID: "call-2" };
      const output = { args: { command: "wget https://example.com/file" } };

      try {
        await plugin["tool.execute.before"](input, output);
        expect(output.args.command).toMatch(/^echo /);
        expect(output.args.command).toContain("context-mode");
      } catch (e: any) {
        expect(e.message).toContain("context-mode");
      }
    });

    it("passes through normal tool calls", async () => {
      const plugin = await createTestPlugin(join(tempDir, "before-pass"));

      // TaskCreate is not routed — should passthrough
      const result = await plugin["tool.execute.before"](
        { tool: "TaskCreate", sessionID: "test-session", callID: "call-3" },
        { args: { subject: "test task" } },
      );

      expect(result).toBeUndefined();
    });

    it("handles empty input gracefully", async () => {
      const plugin = await createTestPlugin(join(tempDir, "before-empty"));

      const result = await plugin["tool.execute.before"](
        {} as any,
        { args: {} } as any,
      );
      expect(result).toBeUndefined();
    });
  });

  // ── tool.execute.after ────────────────────────────────

  describe("tool.execute.after", () => {
    it("captures file read events without throwing", async () => {
      const plugin = await createTestPlugin(join(tempDir, "after-read"));

      // Should not throw
      await expect(
        plugin["tool.execute.after"](
          { tool: "Read", sessionID: "test-session", callID: "call-1", args: { file_path: "/test/file.ts" } },
          { title: "Read", output: "file contents here", metadata: {} },
        ),
      ).resolves.toBeUndefined();
    });

    it("captures file write events", async () => {
      const plugin = await createTestPlugin(join(tempDir, "after-write"));

      await expect(
        plugin["tool.execute.after"](
          { tool: "Write", sessionID: "test-session", callID: "call-2", args: { file_path: "/test/new-file.ts", content: "code" } },
          { title: "Write", output: "", metadata: {} },
        ),
      ).resolves.toBeUndefined();
    });

    it("captures git events from Bash", async () => {
      const plugin = await createTestPlugin(join(tempDir, "after-git"));

      await expect(
        plugin["tool.execute.after"](
          { tool: "Bash", sessionID: "test-session", callID: "call-3", args: { command: "git commit -m 'test'" } },
          { title: "Bash", output: "[main abc1234] test", metadata: {} },
        ),
      ).resolves.toBeUndefined();
    });

    it("handles empty input gracefully", async () => {
      const plugin = await createTestPlugin(join(tempDir, "after-empty"));

      await expect(
        plugin["tool.execute.after"](
          {} as any,
          { title: "", output: "", metadata: {} } as any,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ── experimental.session.compacting ───────────────────

  describe("experimental.session.compacting", () => {
    it("returns empty string when no events captured", async () => {
      const plugin = await createTestPlugin(join(tempDir, "compact-empty"));

      const output = { context: [] as string[], prompt: undefined };
      const snapshot = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        output,
      );
      expect(snapshot).toBe("");
    });

    it("returns snapshot XML after events are captured", async () => {
      const plugin = await createTestPlugin(join(tempDir, "compact-snap"));

      // Capture several events first
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "test-session", callID: "call-1", args: { file_path: "/src/index.ts" } },
        { title: "Read", output: "export default {}", metadata: {} },
      );
      await plugin["tool.execute.after"](
        { tool: "Edit", sessionID: "test-session", callID: "call-2", args: { file_path: "/src/index.ts", old_string: "{}", new_string: "{ foo: 1 }" } },
        { title: "Edit", output: "", metadata: {} },
      );
      await plugin["tool.execute.after"](
        { tool: "Bash", sessionID: "test-session", callID: "call-3", args: { command: "git status" } },
        { title: "Bash", output: "On branch main", metadata: {} },
      );

      const output = { context: [] as string[], prompt: undefined };
      const snapshot = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        output,
      );

      expect(snapshot.length).toBeGreaterThan(0);
      expect(snapshot).toContain("session_resume");
      expect(snapshot).toContain("<files");
      expect(snapshot).toContain("index.ts");
    });

    it("can be called multiple times (increments compact count)", async () => {
      const plugin = await createTestPlugin(join(tempDir, "compact-multi"));

      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "test-session", callID: "call-1", args: { file_path: "/test/a.ts" } },
        { title: "Read", output: "code", metadata: {} },
      );

      const output1 = { context: [] as string[], prompt: undefined };
      const snap1 = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        output1,
      );
      expect(snap1.length).toBeGreaterThan(0);

      // Capture more events
      await plugin["tool.execute.after"](
        { tool: "Write", sessionID: "test-session", callID: "call-2", args: { file_path: "/test/b.ts", content: "new file" } },
        { title: "Write", output: "", metadata: {} },
      );

      const output2 = { context: [] as string[], prompt: undefined };
      const snap2 = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        output2,
      );
      expect(snap2.length).toBeGreaterThan(0);
    });
  });

  // ── experimental.chat.system.transform ────────────────
  // SessionStart-equivalent (PR #376 / Mickey 3-issue fix). Verifies:
  //  • Snapshot is prepended to output.system (NOT output.messages)
  //  • Per-session at-most-once gate (multi-session reuse — Mickey #2)
  //  • Cross-session lookup via DB.claimLatestUnconsumedResume
  //  • Race-safe atomic claim — two parallel transforms get distinct rows

  describe("experimental.chat.system.transform", () => {
    it("is a no-op when sessionID is missing", async () => {
      const plugin = await createTestPlugin(join(tempDir, "sysxform-no-sid"));
      const out = { system: ["existing"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: undefined, model: {} } as any,
        out,
      );
      expect(out.system).toEqual(["existing"]);
    });

    it("is a no-op when no resume snapshot exists", async () => {
      const plugin = await createTestPlugin(join(tempDir, "sysxform-no-resume"));
      const out = { system: [] as string[] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "fresh-session", model: {} } as any,
        out,
      );
      expect(out.system).toEqual([]);
    });

    it("prepends a previously-recorded snapshot to output.system on first call", async () => {
      const projectDir = join(tempDir, "sysxform-inject");
      const plugin = await createTestPlugin(projectDir);

      // Build a snapshot in a *prior* session
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "prior-session", callID: "c1", args: { file_path: "/a.ts" } },
        { title: "Read", output: "content", metadata: {} },
      );
      const compactOut = { context: [] as string[], prompt: undefined };
      await plugin["experimental.session.compacting"](
        { sessionID: "prior-session" } as any,
        compactOut,
      );

      // New session enters via system.transform — must inherit the snapshot
      const out = { system: [] as string[] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "new-session", model: {} } as any,
        out,
      );
      expect(out.system.length).toBe(1);
      expect(out.system[0]).toContain("session_resume");
    });

    it("preserves system[0] header so OpenCode's prompt-cache fold survives", async () => {
      // OpenCode (packages/opencode/src/session/llm.ts:117-128) preserves a
      // 2-part `[header, body]` system structure for provider prompt caching.
      // It saves `header = system[0]` BEFORE invoking this hook, then folds
      // the rest into `[header, body]` only when `system[0] === header` after
      // the hook returns. If we `unshift(snapshot)` we replace system[0] →
      // cache-fold is skipped → each system block ships as a separate
      // `role: "system"` message → provider prompt cache invalidates on every
      // resume injection (token cost regression). We insert at index 1 instead.
      const projectDir = join(tempDir, "sysxform-cache-fold");
      const plugin = await createTestPlugin(projectDir);
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "seed", callID: "c1", args: { file_path: "/y.ts" } },
        { title: "Read", output: "y", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "seed" } as any,
        { context: [] as string[], prompt: undefined },
      );

      const HEADER = "you are claude";
      const BODY = "user system prompt here";
      const out = { system: [HEADER, BODY] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "turn-cache", model: {} } as any,
        out,
      );
      // The snapshot was inserted, but header at index 0 is preserved
      // exactly as OpenCode saw it before the hook.
      expect(out.system[0]).toBe(HEADER);
      expect(out.system.length).toBe(3);
      expect(out.system[1]).toContain("session_resume");
      expect(out.system[2]).toBe(BODY);
    });

    it("does NOT re-inject on second call with the same sessionID (multi-turn)", async () => {
      const projectDir = join(tempDir, "sysxform-once-per-session");
      const plugin = await createTestPlugin(projectDir);

      // Seed snapshot
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "seed", callID: "c1", args: { file_path: "/x.ts" } },
        { title: "Read", output: "x", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "seed" } as any,
        { context: [] as string[], prompt: undefined },
      );

      const out1 = { system: [] as string[] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "turn-X", model: {} } as any,
        out1,
      );
      expect(out1.system.length).toBe(1);

      const out2 = { system: [] as string[] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "turn-X", model: {} } as any,
        out2,
      );
      // Same session — already injected this process — silent.
      expect(out2.system).toEqual([]);
    });

    // v1.0.106 — Mickey #376 follow-up: self-injection guard
    it("does NOT inject snapshot back into the session that produced it (self-injection guard)", async () => {
      const projectDir = join(tempDir, "sysxform-self-inject");
      const plugin = await createTestPlugin(projectDir);

      // Session B does work and compacts — produces ITS OWN snapshot row.
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "B", callID: "c1", args: { file_path: "/p.ts" } },
        { title: "Read", output: "p", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "B" } as any,
        { context: [] as string[], prompt: undefined },
      );

      // B's NEXT chat turn fires system.transform — must NOT splice B's
      // own snapshot back into B's prompt (wasteful + would consume the
      // row meant for the next fresh session).
      const out = { system: ["HEADER", "BODY"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "B", model: {} } as any,
        out,
      );
      expect(out.system).toEqual(["HEADER", "BODY"]);
    });

    // v1.0.106 — when no row exists, do NOT mark sessionId as injected,
    // so a later call within the same session can still pick up a snapshot
    // that arrived after the first attempt.
    it("retries on next turn when no row exists (no premature gate)", async () => {
      const projectDir = join(tempDir, "sysxform-retry");
      const plugin = await createTestPlugin(projectDir);

      // First call — no snapshot in DB yet
      const out1 = { system: ["HEADER"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "C", model: {} } as any,
        out1,
      );
      expect(out1.system).toEqual(["HEADER"]); // no inject

      // Now a different session compacts and produces a snapshot
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "donor", callID: "c1", args: { file_path: "/q.ts" } },
        { title: "Read", output: "q", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "donor" } as any,
        { context: [] as string[], prompt: undefined },
      );

      // C's next turn — should pick up the donor's snapshot (not stuck silent)
      const out2 = { system: ["HEADER"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "C", model: {} } as any,
        out2,
      );
      expect(out2.system.length).toBe(2);
      expect(out2.system[1]).toContain("session_resume");
    });

    // v1.0.106 — prefer next session over self-injection
    it("snapshot from B is consumed by C, not by B itself", async () => {
      const projectDir = join(tempDir, "sysxform-b-to-c");
      const plugin = await createTestPlugin(projectDir);

      // Session B compacts → produces row
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "B", callID: "c1", args: { file_path: "/r.ts" } },
        { title: "Read", output: "r", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "B" } as any,
        { context: [] as string[], prompt: undefined },
      );

      // B asks for inject — gets nothing (own row excluded)
      const outB = { system: ["HEADER"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "B", model: {} } as any,
        outB,
      );
      expect(outB.system).toEqual(["HEADER"]);

      // C asks — gets B's snapshot
      const outC = { system: ["HEADER"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "C", model: {} } as any,
        outC,
      );
      expect(outC.system.length).toBe(2);
      expect(outC.system[1]).toContain("session_resume");
    });

    // v1.0.106 — visible signal so users can confirm the feature actually
    // fired (without it Mickey reported "I can't find use case for it" —
    // the inject was silent and invisible in OPENCODE_DEBUG logs).
    it("emits a visible context-mode marker comment alongside the snapshot", async () => {
      const projectDir = join(tempDir, "sysxform-marker");
      const plugin = await createTestPlugin(projectDir);

      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "donor", callID: "c1", args: { file_path: "/m.ts" } },
        { title: "Read", output: "m", metadata: {} },
      );
      await plugin["experimental.session.compacting"](
        { sessionID: "donor" } as any,
        { context: [] as string[], prompt: undefined },
      );

      const out = { system: ["HEADER"] };
      await plugin["experimental.chat.system.transform"](
        { sessionID: "consumer", model: {} } as any,
        out,
      );
      expect(out.system.length).toBe(2);
      expect(out.system[1]).toMatch(/^<!-- context-mode v[\d.]+: resumed prior session [\w-]{1,8}/);
    });
  });

  // ── Integration: before + after + compact ─────────────

  describe("end-to-end flow", () => {
    it("captures events from allowed tools and generates snapshot", async () => {
      const plugin = await createTestPlugin(join(tempDir, "e2e-flow"));

      // Normal tool call passes through before hook
      await plugin["tool.execute.before"](
        { tool: "Read", sessionID: "test-session", callID: "call-1" },
        { args: { file_path: "/app/main.ts" } },
      );

      // After hook captures the event
      await plugin["tool.execute.after"](
        { tool: "Read", sessionID: "test-session", callID: "call-1", args: { file_path: "/app/main.ts" } },
        { title: "Read", output: "console.log('hello')", metadata: {} },
      );

      // Compacting generates snapshot
      const output = { context: [] as string[], prompt: undefined };
      const snapshot = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        output,
      );
      expect(snapshot).toContain("session_resume");
      expect(snapshot).toContain("<files");
      expect(snapshot).toContain("main.ts");
    });

    it("blocked tool command is replaced before execution", async () => {
      const plugin = await createTestPlugin(join(tempDir, "e2e-block"));
      const beforeInput = { tool: "Bash", sessionID: "test-session", callID: "call-1" };
      const beforeOutput = { args: { command: "curl https://evil.com" } };

      // Before hook blocks/modifies the command
      let blocked = false;
      try {
        await plugin["tool.execute.before"](beforeInput, beforeOutput);
        // If modified (not thrown), the command was replaced
        expect(beforeOutput.args.command).toContain("context-mode");
      } catch (e: any) {
        // deny action throws
        blocked = true;
        expect(e.message).toContain("context-mode");
      }

      if (!blocked) {
        // After hook still runs (with the replaced command)
        await plugin["tool.execute.after"](
          { tool: "Bash", sessionID: "test-session", callID: "call-1", args: beforeOutput.args },
          { title: "Bash", output: beforeOutput.args.command, metadata: {} },
        );
      }

      // Snapshot should be empty (echo/blocked commands don't generate events)
      const compactOutput = { context: [] as string[], prompt: undefined };
      const snapshot = await plugin["experimental.session.compacting"](
        { sessionID: "test-session" },
        compactOutput,
      );
      expect(snapshot).toBe("");
    });
  });
});
