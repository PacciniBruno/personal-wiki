/**
 * claude-print.js — Spawn `claude -p` with a prompt fed via stdin.
 *
 * Used by both tier-1/tier-2 theme synthesis (synthesize.js) and per-project
 * wiki synthesis (synthesize-projects.js). Stdin avoids variadic flags eating
 * the prompt arg.
 *
 * Sandbox: the security boundary is the working directory.
 *   cwd = KB_DIR              — the agent's only allowed working directory.
 *                               File access (Read/Write/Edit) and Bash commands
 *                               targeting paths outside KB_DIR are blocked by
 *                               Claude Code's directory restriction. The repo
 *                               source files at $REPO/src/* stay out of reach.
 *   --setting-sources=user    — ignore project + local .claude/settings* files
 *                               (the local file in this repo grants `node`,
 *                               `npm`, `git`, etc.). The user-level file only
 *                               grants benign read commands on ~/knowledge.
 *   --allowedTools            — explicit allowlist; Bash is restricted to
 *                               `tail` (the only shell command our prompts use).
 *                               Within KB_DIR the agent can still Read/Write
 *                               freely — that's the residual risk a directory
 *                               sandbox accepts.
 *
 * Failure handling: --output-format json gives structured results. Any
 * non-success run (non-zero exit, is_error, or unparsable output) is appended
 * to $STATE_DIR/synth-failures.log with the prompt prefix and raw streams so
 * future failures stop being silent.
 */

import { spawn } from 'child_process'
import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { CLAUDE_BIN, KB_DIR, STATE_DIR } from './config.js'

const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash(tail *)',
]

const FAILURES_LOG = join(STATE_DIR, 'synth-failures.log')

// Env vars that, if present, route `claude` to API billing instead of the
// user's Claude subscription. We strip them from the child env so every
// `claude -p` call (synthesis AND categorization) uses the subscription.
const API_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]

// When this runs *inside* a Claude Code / Claude Desktop session (e.g. sync
// launched from the desktop app), the host injects OAuth vars that make the
// spawned `claude` expect a host-provided token refresh — with no host to
// supply it, that surfaces as a spurious `401 Invalid authentication
// credentials`. Stripping them forces the child onto the Keychain
// subscription. A clean launchd/terminal env doesn't have these, so removing
// them there is a harmless no-op.
const HOST_AUTH_ENV_KEYS = [
  'CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_ENTRYPOINT',
]

function subscriptionEnv() {
  const env = { ...process.env }
  for (const k of API_AUTH_ENV_KEYS)  delete env[k]
  for (const k of HOST_AUTH_ENV_KEYS) delete env[k]
  return env
}

async function logFailure({ prompt, stdout, stderr, code, parsed, reason }) {
  const ts = new Date().toISOString()
  const preview = prompt.slice(0, 240).replace(/\n/g, ' ')
  const body = [
    `─── ${ts} ─── ${reason} (exit=${code})`,
    `prompt: ${preview}${prompt.length > 240 ? '…' : ''}`,
    parsed ? `parsed: ${JSON.stringify(parsed).slice(0, 1200)}` : null,
    stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
    stdout.trim() ? `stdout:\n${stdout.trim().slice(0, 2000)}` : null,
    '',
  ].filter(Boolean).join('\n')
  try {
    await mkdir(STATE_DIR, { recursive: true })
    await appendFile(FAILURES_LOG, body + '\n')
  } catch {
    // Best-effort logging; never throw from the logger.
  }
}

/**
 * @param {string} prompt
 * @param {number} timeoutMs
 * @param {{ tools?: 'default'|'none', model?: string, maxBudgetUsd?: string, allowedTools?: string[] }} [options]
 *   - tools: 'default' agentic mode (ALLOWED_TOOLS), 'none' text-in/text-out
 *   - model: per-call model override (default: $SYNTH_MODEL or 'sonnet')
 *   - maxBudgetUsd: per-call cost ceiling (default: $SYNTH_MAX_USD or '3.00').
 *     Categorization passes a low cap; project synthesis (heaviest inputs)
 *     passes a higher one.
 *   - allowedTools: explicit tool allowlist that replaces ALLOWED_TOOLS — used
 *     to grant an MCP server (e.g. ['mcp__xapi', 'Write'] for the X bookmarks
 *     fetch).
 *   - mcpConfig: JSON string of MCP servers to load for this call only, passed
 *     via `--mcp-config` + `--strict-mcp-config`. Used by the X bookmarks fetch
 *     so `xapi` doesn't need to be a globally-registered (user-scoped) server —
 *     which would auto-launch `xurl mcp` (and its interactive OAuth browser
 *     popup) in every unrelated Claude Code session.
 */
export function claudePrint(prompt, timeoutMs, { tools = 'default', model, maxBudgetUsd, allowedTools, mcpConfig } = {}) {
  return new Promise((resolve, reject) => {
    const toolArgs =
      allowedTools    ? ['--allowedTools', ...allowedTools] :
      tools === 'none' ? ['--tools', ''] :
                         ['--allowedTools', ...ALLOWED_TOOLS]

    const mcpArgs = mcpConfig ? ['--mcp-config', mcpConfig, '--strict-mcp-config'] : []

    const child = spawn(CLAUDE_BIN, [
      '--print',
      '--model', model ?? process.env.SYNTH_MODEL ?? 'sonnet',
      '--max-budget-usd', maxBudgetUsd ?? process.env.SYNTH_MAX_USD ?? '3.00',
      '--output-format', 'json',
      '--setting-sources', 'user',
      ...toolArgs,
      ...mcpArgs,
    ], { timeout: timeoutMs, cwd: KB_DIR, env: subscriptionEnv() })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', async code => {
      let parsed = null
      try { parsed = JSON.parse(stdout) } catch {}

      if (code === 0 && parsed && parsed.is_error === false) {
        return resolve(parsed.result ?? stdout)
      }

      const reason =
        parsed?.api_error_status ? `api ${parsed.api_error_status}` :
        parsed?.subtype          ? `subtype ${parsed.subtype}`      :
        code === 143             ? 'timeout/SIGTERM'                :
        stderr.trim()            ? 'stderr'                         :
        'non-zero exit'

      await logFailure({ prompt, stdout, stderr, code, parsed, reason })

      const msg = parsed?.result || parsed?.api_error_status || stderr.trim() || `exit code ${code}`
      reject(new Error(`${reason}: ${msg}`))
    })
    child.on('error', reject)

    child.stdin.write(prompt)
    child.stdin.end()
  })
}
