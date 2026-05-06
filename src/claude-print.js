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
 * What's NOT reachable: /etc, ~/.ssh, ~/.aws, ~/.config, the repo source files,
 * the network (no curl/WebFetch), package managers, git, file deletion (no rm),
 * process control, anything outside ~/knowledge.
 */

import { spawn } from 'child_process'
import { CLAUDE_BIN, KB_DIR } from './config.js'

const ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash(tail *)',
]

export function claudePrint(prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '--print',
      '--setting-sources', 'user',
      '--allowedTools', ...ALLOWED_TOOLS,
    ], { timeout: timeoutMs, cwd: KB_DIR })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `exit code ${code}`))
    })
    child.on('error', reject)

    child.stdin.write(prompt)
    child.stdin.end()
  })
}
