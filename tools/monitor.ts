import { parseArgs as parseFlags } from "node:util"

type Condition = "merged" | "checks-passed"
type Status = "pending" | "ready" | "failed"

export type Options = {
  url: string
  until: Condition
  timeout: number
  interval: number
  checkTimeout: number
}

export type Snapshot = {
  status: Status
  reason: string
  headSha?: string
}

export type Result = Omit<Snapshot, "status"> & {
  status: Exclude<Status, "pending"> | "timeout" | "error" | "cancelled"
  url: string
  until: Condition
  elapsedSeconds: number
}

export class CheckError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message)
  }
}

const pollingHelp = `
  --timeout <duration>        Overall deadline (default: 30m)
  --interval <duration>       Poll interval (default: 30s)
  --check-timeout <duration>  Per-check deadline (default: 20s)

Durations accept ms, s, m, or h. Stdout contains one terminal JSON result.
Exit codes: 0 ready, 1 failed, 2 error, 124 timeout, 130 cancelled.`

const targets = [
  {
    name: "github-pr",
    description: "Wait for a GitHub pull request to merge or its reported CI checks to pass",
    help: `Usage: monitor github-pr <url> --until merged|checks-passed

Requires an authenticated gh CLI. URLs must be https://github.com/owner/repo/pull/number.

Conditions:
  merged         Ready when the PR merges. A closed, unmerged PR fails.
  checks-passed  Follows the current PR head and evaluates all reported checks,
                 including legacy commit statuses. Neutral and skipped checks
                 count as successful. No reported checks remains pending.
                 A failed or cancelled check, or a closed, unmerged PR, fails.

Checks passing does not guarantee every expected workflow has started or that
branch protection permits merging. Recheck the head SHA before acting on a commit.

Result fields: status, reason, url, until, elapsedSeconds, and the last observed
headSha when available. Authentication and invalid responses stop immediately.
Transient failures get at most three consecutive attempts.
${pollingHelp}

Examples:
  monitor github-pr https://github.com/owner/repo/pull/123 --until merged --timeout 30m
  monitor github-pr https://github.com/owner/repo/pull/123 --until checks-passed --timeout 15m`,
  },
]

const usage = `Usage: monitor <target> [options]
       monitor targets
       monitor <target> --help

Wait for an external condition, then return a terminal JSON result.
Run monitor targets to list available targets as JSON.
Run monitor <target> --help for conditions, prerequisites, and result fields.
${pollingHelp}`

const duration = (value: string) => {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value)
  if (!match) throw new Error(`Invalid duration: ${value}`)

  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }
  const milliseconds = Number(match[1]) * units[match[2]]
  if (milliseconds < 1 || milliseconds > 2_147_483_647) {
    throw new Error("Durations must be between 1ms and 2147483647ms")
  }

  return milliseconds
}

export const parseArgs = (args: string[]): Options => {
  const { values, positionals } = parseFlags({
    args,
    allowPositionals: true,
    options: {
      until: { type: "string" },
      timeout: { type: "string" },
      interval: { type: "string" },
      "check-timeout": { type: "string" },
    },
  })

  if (positionals.length !== 2 || positionals[0] !== "github-pr") {
    throw new Error("Expected github-pr followed by a pull request URL")
  }
  if (values.until !== "merged" && values.until !== "checks-passed") {
    throw new Error("--until must be merged or checks-passed")
  }

  const url = new URL(positionals[1])
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Expected an https://github.com/owner/repo/pull/number URL")
  }

  return {
    url: url.href.replace(/\/$/, ""),
    until: values.until,
    timeout: duration(values.timeout ?? "30m"),
    interval: duration(values.interval ?? "30s"),
    checkTimeout: duration(values["check-timeout"] ?? "20s"),
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CheckError("Invalid GitHub response")
  }

  return value as Record<string, unknown>
}

const checkState = (value: unknown): { name: string; status: Status } => {
  const check = record(value)
  const name = check.name ?? check.context
  if (typeof name !== "string") throw new CheckError("Invalid GitHub check name")

  if (check.__typename === "CheckRun" && check.status !== "COMPLETED") {
    if (
      ["QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "PENDING"].includes(String(check.status))
    ) {
      return { name, status: "pending" }
    }

    throw new CheckError(`Unknown GitHub check status for ${name}: ${String(check.status)}`)
  }

  const state =
    check.__typename === "CheckRun"
      ? check.conclusion
      : check.__typename === "StatusContext"
        ? check.state
        : undefined

  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(String(state))) {
    return { name, status: "ready" }
  }
  if (check.__typename === "StatusContext" && ["PENDING", "EXPECTED"].includes(String(state))) {
    return { name, status: "pending" }
  }
  if (
    [
      "FAILURE",
      "ERROR",
      "CANCELLED",
      "TIMED_OUT",
      "ACTION_REQUIRED",
      "STALE",
      "STARTUP_FAILURE",
    ].includes(String(state))
  ) {
    return { name, status: "failed" }
  }

  throw new CheckError(`Unknown GitHub check state for ${name}: ${String(state)}`)
}

export const evaluatePullRequest = (value: unknown, until: Condition): Snapshot => {
  const pr = record(value)
  if (
    !["OPEN", "CLOSED", "MERGED"].includes(String(pr.state)) ||
    typeof pr.headRefOid !== "string"
  ) {
    throw new CheckError("Invalid GitHub pull request response")
  }

  const headSha = pr.headRefOid
  if (pr.state === "CLOSED") {
    return { status: "failed", reason: "Pull request closed without merging", headSha }
  }
  if (until === "merged") {
    return pr.state === "MERGED"
      ? { status: "ready", reason: "Pull request merged", headSha }
      : { status: "pending", reason: "Waiting for pull request to merge", headSha }
  }

  if (!Array.isArray(pr.statusCheckRollup)) {
    throw new CheckError("Invalid GitHub status check response")
  }
  if (pr.statusCheckRollup.length === 0) {
    return {
      status: "pending",
      reason: "Waiting for checks to appear on the current head",
      headSha,
    }
  }

  const checks = pr.statusCheckRollup.map(checkState)
  const failed = checks.filter((check) => check.status === "failed")
  if (failed.length) {
    return {
      status: "failed",
      reason: `Checks failed: ${failed.map((check) => check.name).join(", ")}`,
      headSha,
    }
  }

  const pending = checks.filter((check) => check.status === "pending")
  return pending.length
    ? {
        status: "pending",
        reason: `Waiting for checks: ${pending.map((check) => check.name).join(", ")}`,
        headSha,
      }
    : {
        status: "ready",
        reason: "All reported checks passed, were neutral, or were skipped",
        headSha,
      }
}

const checkGitHub = async (options: Options, signal: AbortSignal): Promise<Snapshot> => {
  const fields = ["state", "headRefOid"]
  if (options.until === "checks-passed") fields.push("statusCheckRollup")

  let process: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    process = Bun.spawn(["gh", "pr", "view", options.url, "--json", fields.join(",")], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...Bun.env, GH_PROMPT_DISABLED: "1" },
    })
  } catch (error) {
    throw new CheckError(
      `Could not start gh: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const cancel = () => process.kill("SIGKILL")
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    if (signal.aborted) throw new CheckError("GitHub check timed out", true)
    if (exitCode !== 0) {
      const reason = stderr.trim() || `gh exited with code ${exitCode}`
      const retryable =
        /HTTP 5\d\d|HTTP 429|rate limit|connection|network|TLS handshake|timeout|timed out|temporary failure|unexpected EOF/i.test(
          reason,
        )
      throw new CheckError(reason, retryable)
    }

    let value: unknown
    try {
      value = JSON.parse(stdout)
    } catch {
      throw new CheckError("gh returned invalid JSON")
    }

    return evaluatePullRequest(value, options.until)
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

const sleep = async (milliseconds: number, signal: AbortSignal) => {
  if (signal.aborted) return

  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
  })
}

export const monitor = async (
  options: Options,
  {
    signal = new AbortController().signal,
    check = checkGitHub,
    report = (message: string) => console.error(message),
  }: {
    signal?: AbortSignal
    check?: (options: Options, signal: AbortSignal) => Promise<Snapshot>
    report?: (message: string) => void
  } = {},
): Promise<Result> => {
  const started = performance.now()
  const deadline = started + options.timeout
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeout)
  const stop = AbortSignal.any([signal, controller.signal])

  let latest: Snapshot | undefined
  let lastProgress = ""
  let errors = 0

  const finish = (status: Result["status"], reason: string): Result => ({
    status,
    reason,
    headSha: latest?.headSha,
    url: options.url,
    until: options.until,
    elapsedSeconds: Math.round((performance.now() - started) / 1_000),
  })

  const progress = (message: string) => {
    if (message === lastProgress) return
    report(message)
    lastProgress = message
  }

  try {
    while (!stop.aborted && performance.now() < deadline) {
      const checkController = new AbortController()
      const checkTimer = setTimeout(() => checkController.abort(), options.checkTimeout)

      try {
        latest = await check(options, AbortSignal.any([stop, checkController.signal]))
        errors = 0
        if (stop.aborted || performance.now() >= deadline) break
        if (latest.status !== "pending") return finish(latest.status, latest.reason)

        progress(`${latest.reason} (${latest.headSha ?? "unknown head"})`)
      } catch (error) {
        if (stop.aborted || performance.now() >= deadline) break

        const reason = error instanceof Error ? error.message : String(error)
        errors += 1
        if (!(error instanceof CheckError) || !error.retryable || errors >= 3) {
          return finish("error", reason)
        }

        progress(`Retrying GitHub check (${errors}/3): ${reason}`)
      } finally {
        clearTimeout(checkTimer)
      }

      await sleep(Math.max(0, Math.min(options.interval, deadline - performance.now())), stop)
    }

    return signal.aborted
      ? finish("cancelled", "Monitoring cancelled")
      : finish("timeout", `Deadline reached${latest ? `. Last observation: ${latest.reason}` : ""}`)
  } finally {
    clearTimeout(timer)
  }
}

export const main = async (args: string[]): Promise<number> => {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage)
    return 0
  }

  if (args.length === 1 && args[0] === "targets") {
    console.log(
      JSON.stringify(targets.map(({ name, description }) => ({ name, description }))),
    )
    return 0
  }

  const target = targets.find(({ name }) => name === args[0])
  if (target && args.length === 2 && (args[1] === "--help" || args[1] === "-h")) {
    console.log(target.help)
    return 0
  }

  let options: Options
  try {
    options = parseArgs(args)
  } catch (error) {
    console.log(
      JSON.stringify({
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
    console.error(usage)
    return 2
  }

  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.on("SIGINT", cancel)
  process.on("SIGTERM", cancel)

  try {
    const result = await monitor(options, { signal: controller.signal })
    console.log(JSON.stringify(result))

    const codes = { ready: 0, failed: 1, error: 2, timeout: 124, cancelled: 130 }
    return codes[result.status]
  } finally {
    process.off("SIGINT", cancel)
    process.off("SIGTERM", cancel)
  }
}

if (import.meta.main) process.exitCode = await main(Bun.argv.slice(2))
