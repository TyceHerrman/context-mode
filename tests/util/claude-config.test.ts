/**
 * Tests for `resolveClaudeConfigDir` — the single-source-of-truth resolver
 * used by every Claude-aware reader (adapters, server, security, hooks).
 *
 * Issue #460 round-3: ALL Claude config readers MUST consume this util so a
 * single CLAUDE_CONFIG_DIR env change steers every code path identically.
 * Behavioural contract pinned here (mirrors hooks/session-helpers.mjs::
 * resolveConfigDir):
 *
 *   - env unset             → ~/.claude
 *   - env empty             → ~/.claude  (regression: empty must not poison
 *                                          downstream join/resolve calls)
 *   - env whitespace-only   → ~/.claude  (regression guard for shells that
 *                                          quote-pad the value)
 *   - env starts with `~`   → expanded against homedir(), strip single
 *                             leading `/` or `\` (cross-platform)
 *   - env absolute path     → resolve()'d (already absolute, returned as-is
 *                                          after normalisation)
 *   - env relative path     → resolve()'d to absolute (relative anchors to cwd)
 */
import { describe, test, beforeEach, afterAll } from "vitest";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  resolveAdapterGlobalSettingsPaths,
  resolveClaudeConfigDir,
  resolveClaudeGlobalSettingsPath,
} from "../../src/util/claude-config.js";

const SAVED = process.env.CLAUDE_CONFIG_DIR;

describe("resolveClaudeConfigDir — CLAUDE_CONFIG_DIR contract", () => {
  beforeEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
  });

  afterAll(() => {
    if (SAVED === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = SAVED;
  });

  test("env unset → ~/.claude", () => {
    assert.equal(resolveClaudeConfigDir(), resolve(homedir(), ".claude"));
  });

  test("env empty string → ~/.claude (must not propagate empty)", () => {
    process.env.CLAUDE_CONFIG_DIR = "";
    assert.equal(resolveClaudeConfigDir(), resolve(homedir(), ".claude"));
  });

  test("env whitespace-only → ~/.claude (regression: trim guard)", () => {
    process.env.CLAUDE_CONFIG_DIR = "   ";
    assert.equal(resolveClaudeConfigDir(), resolve(homedir(), ".claude"));
  });

  test("env tab/newline whitespace → ~/.claude", () => {
    process.env.CLAUDE_CONFIG_DIR = "\t\n";
    assert.equal(resolveClaudeConfigDir(), resolve(homedir(), ".claude"));
  });

  test("env absolute path → resolve()'d as-is", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/cm-test-cfg-dir";
    assert.equal(resolveClaudeConfigDir(), resolve("/tmp/cm-test-cfg-dir"));
  });

  test("env tilde-only → homedir()", () => {
    process.env.CLAUDE_CONFIG_DIR = "~";
    assert.equal(resolveClaudeConfigDir(), resolve(homedir()));
  });

  test("env ~/sub → homedir/sub", () => {
    process.env.CLAUDE_CONFIG_DIR = "~/my-cc";
    assert.equal(resolveClaudeConfigDir(), resolve(homedir(), "my-cc"));
  });

  test("env passed via explicit object overrides process.env", () => {
    process.env.CLAUDE_CONFIG_DIR = "/should-not-be-used";
    assert.equal(
      resolveClaudeConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/explicit" }),
      resolve("/tmp/explicit"),
    );
  });

  test("resolveClaudeGlobalSettingsPath: appends settings.json", () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/cm-test-cfg-dir";
    assert.equal(
      resolveClaudeGlobalSettingsPath(),
      resolve("/tmp/cm-test-cfg-dir", "settings.json"),
    );
  });

  test("resolveClaudeGlobalSettingsPath: empty env → ~/.claude/settings.json", () => {
    process.env.CLAUDE_CONFIG_DIR = "";
    assert.equal(
      resolveClaudeGlobalSettingsPath(),
      resolve(homedir(), ".claude", "settings.json"),
    );
  });
});

describe("resolveAdapterGlobalSettingsPaths — effective Codex sandbox policy (#944)", () => {
  const savedPlatform = process.env.CONTEXT_MODE_PLATFORM;

  afterAll(() => {
    if (savedPlatform === undefined) delete process.env.CONTEXT_MODE_PLATFORM;
    else process.env.CONTEXT_MODE_PLATFORM = savedPlatform;
  });

  test("Codex returns no Claude-shaped JSON policy paths", () => {
    process.env.CONTEXT_MODE_PLATFORM = "codex";
    const paths = resolveAdapterGlobalSettingsPaths({
      CODEX_HOME: "/tmp/fake-codex-home",
      CLAUDE_CONFIG_DIR: "/tmp/co-installed-claude",
    });
    assert.deepEqual(paths, []);
  });

  test("non-Codex adapters retain adapter-specific plus Claude fallback paths", () => {
    process.env.CONTEXT_MODE_PLATFORM = "cursor";
    const claudeDir = "/tmp/claude-policy-control";
    const paths = resolveAdapterGlobalSettingsPaths({
      CLAUDE_CONFIG_DIR: claudeDir,
    });
    assert.deepEqual(paths, [
      resolve(homedir(), ".cursor", "settings.json"),
      resolve(claudeDir, "settings.json"),
    ]);
  });
});
