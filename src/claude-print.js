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
// user's Claude subscription. We strip them from the child env so synthesis
// always uses the subscription. The Haiku categorizer (categorize.js) uses
// the Anthropic SDK directly and is unaffected.
const API_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BEDROCK_BASE_URL',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
]

function subscriptionEnv() {
  const env = { ...process.env }
  for (const k of API_AUTH_ENV_KEYS) delete env[k]
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
 * @param {{ tools?: 'default'|'none' }} [options]
 *   - 'default' (the default): agentic mode, ALLOWED_TOOLS list active
 *   - 'none': pure text-in/text-out, no tool calls. Use this when the entire
 *     input is inlined in the prompt — avoids the multi-turn cache-write churn
 *     that drove tier-2's cost.
 */
export function claudePrint(prompt, timeoutMs, { tools = 'default' } = {}) {
  return new Promise((resolve, reject) => {
    const toolArgs = tools === 'none'
      ? ['--tools', '']
      : ['--allowedTools', ...ALLOWED_TOOLS]

    const child = spawn(CLAUDE_BIN, [
      '--print',
      '--model', process.env.SYNTH_MODEL ?? 'sonnet',
      '--max-budget-usd', process.env.SYNTH_MAX_USD ?? '0.50',
      '--output-format', 'json',
      '--setting-sources', 'user',
      ...toolArgs,
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
