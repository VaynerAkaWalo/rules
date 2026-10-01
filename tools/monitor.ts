import { parseArgs as parseFlags } from "node:util"

type Condition = "merged" | "checks-passed"
type Status = "pending" | "ready" | "failed"
type Platform = "GitHub" | "GitLab"

export type Options = {
  target: TargetName
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

const resultHelp = `Result fields: status, reason, url, until, elapsedSeconds, and the last observed
headSha when available. Authentication and invalid responses stop immediately.
Transient failures get at most three consecutive attempts.`

type Target = {
  platform: Platform
  description: string
  conditions: Condition[]
  hostname?: string
  path: RegExp
  help: string
}

const targets = {
  "github-pr": {
    platform: "GitHub",
    description: "Wait for a GitHub pull request to merge or its reported CI checks to pass",
    conditions: ["merged", "checks-passed"],
    hostname: "github.com",
    path: /^\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$/,
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

${resultHelp}
${pollingHelp}

Examples:
  monitor github-pr https://github.com/owner/repo/pull/123 --until merged --timeout 30m
  monitor github-pr https://github.com/owner/repo/pull/123 --until checks-passed --timeout 15m`,
  },
  "gitlab-mr": {
    platform: "GitLab",
    description: "Wait for a GitLab merge request to merge or its current-head pipeline to pass",
    conditions: ["merged", "checks-passed"],
    path: /^\/[^/]+(?:\/[^/]+)+\/-\/merge_requests\/[1-9]\d*\/?$/,
    help: `Usage: monitor gitlab-mr <url> --until merged|checks-passed

Requires a glab CLI authenticated for the URL's host, including self-hosted GitLab.
URLs must be https://host/group/project/-/merge_requests/number. Nested groups work.

Conditions:
  merged         Ready when the MR merges. A closed, unmerged MR fails.
  checks-passed  Follows the MR head pipeline and requires it to run on the current
                 head, directly or through a merged results or merge train commit.
                 Successful and skipped pipelines pass. Missing, outdated, manual,
                 and scheduled pipelines remain pending. A failed, canceling, or
                 canceled pipeline, or a closed, unmerged MR, fails.

Checks passing does not guarantee mergeability or that every expected job ran.
Recheck the head SHA before acting on a commit.

${resultHelp}
${pollingHelp}

Examples:
  monitor gitlab-mr https://gitlab.com/group/project/-/merge_requests/123 --until merged
  monitor gitlab-mr https://gitlab.example.com/group/sub/project/-/merge_requests/123 \\
    --until checks-passed --timeout 15m`,
  },
  "gitlab-pipeline": {
    platform: "GitLab",
    description: "Wait for a GitLab pipeline to pass",
    conditions: ["checks-passed"],
    path: /^\/[^/]+(?:\/[^/]+)+\/-\/pipelines\/[1-9]\d*\/?$/,
    help: `Usage: monitor gitlab-pipeline <url> --until checks-passed

Requires a glab CLI authenticated for the URL's host, including self-hosted GitLab.
URLs must be https://host/group/project/-/pipelines/number. Nested groups work.

Conditions:
  checks-passed  Successful and skipped pipelines pass. Manual and scheduled
                 pipelines remain pending. Failed, canceling, and canceled
                 pipelines fail. headSha is the commit the pipeline ran on.

${resultHelp}
${pollingHelp}

Examples:
  monitor gitlab-pipeline https://gitlab.com/group/project/-/pipelines/456 --until checks-passed`,
  },
} satisfies Record<string, Target>

type TargetName = keyof typeof targets

const isTarget = (name: string | undefined): name is TargetName =>
  name !== undefined && Object.hasOwn(targets, name)

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

  const [name, address] = positionals
  if (positionals.length !== 2 || !isTarget(name)) {
    throw new Error("Expected a supported target followed by its URL")
  }
  if (values.until !== "merged" && values.until !== "checks-passed") {
    throw new Error("--until must be merged or checks-passed")
  }

  const target: Target = targets[name]
  if (!target.conditions.includes(values.until)) {
    throw new Error(`${name} requires --until ${target.conditions.join(" or ")}`)
  }

  const url = new URL(address)
  if (
    url.protocol !== "https:" ||
    (target.hostname && url.hostname !== target.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    !target.path.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Expected a ${name} URL as described by monitor ${name} --help`)
  }

  return {
    target: name,
    url: url.href.replace(/\/$/, ""),
    until: values.until,
    timeout: duration(values.timeout ?? "30m"),
    interval: duration(values.interval ?? "30s"),
    checkTimeout: duration(values["check-timeout"] ?? "20s"),
  }
}

const record = (value: unknown, platform: Platform = "GitHub"): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CheckError(`Invalid ${platform} response`)
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

const pipelineStatuses = new Map<unknown, Status>([
  ["success", "ready"],
  ["skipped", "ready"],
  ["failed", "failed"],
  ["canceling", "failed"],
  ["canceled", "failed"],
  ["created", "pending"],
  ["waiting_for_resource", "pending"],
  ["waiting_for_callback", "pending"],
  ["preparing", "pending"],
  ["pending", "pending"],
  ["running", "pending"],
  ["manual", "pending"],
  ["scheduled", "pending"],
  ["blocked", "pending"],
])

export const evaluatePipeline = (value: unknown): Snapshot => {
  const pipeline = record(value, "GitLab")
  if (typeof pipeline.sha !== "string" || !pipeline.sha) {
    throw new CheckError("Invalid GitLab pipeline SHA")
  }

  const status = pipelineStatuses.get(pipeline.status)
  if (!status) throw new CheckError(`Unknown GitLab pipeline status: ${String(pipeline.status)}`)

  return {
    status,
    reason:
      status === "pending"
        ? `Waiting for pipeline: ${pipeline.status}`
        : `Pipeline ${pipeline.status}`,
    headSha: pipeline.sha,
  }
}

export const evaluateMergeRequest = (
  value: unknown,
  until: Condition,
  pipelineParents: string[] = [],
): Snapshot => {
  const mr = record(value, "GitLab")
  if (
    !["opened", "closed", "merged", "locked"].includes(String(mr.state)) ||
    typeof mr.sha !== "string" ||
    !mr.sha
  ) {
    throw new CheckError("Invalid GitLab merge request response")
  }

  const headSha = mr.sha
  if (mr.state === "closed") {
    return { status: "failed", reason: "Merge request closed without merging", headSha }
  }
  if (until === "merged") {
    return mr.state === "merged"
      ? { status: "ready", reason: "Merge request merged", headSha }
      : { status: "pending", reason: "Waiting for merge request to merge", headSha }
  }

  const waiting: Snapshot = {
    status: "pending",
    reason: "Waiting for a pipeline on the current head",
    headSha,
  }
  if (mr.head_pipeline === null) return waiting

  const pipeline = evaluatePipeline(mr.head_pipeline)
  const current = pipeline.headSha === headSha || pipelineParents.includes(headSha)
  return current ? { ...pipeline, headSha } : waiting
}

const mergeRequestRef = /^refs\/merge-requests\/\d+\/(?:merge|train)$/

const mergedResultCommit = (value: unknown): string | undefined => {
  const mr = record(value, "GitLab")
  if (!mr.head_pipeline || typeof mr.head_pipeline !== "object") return undefined

  const { ref, sha } = mr.head_pipeline as Record<string, unknown>
  if (typeof ref !== "string" || !mergeRequestRef.test(ref)) return undefined

  return typeof sha === "string" && /^[0-9a-f]+$/.test(sha) && sha !== mr.sha ? sha : undefined
}

const commitParents = (value: unknown): string[] => {
  const { parent_ids } = record(value, "GitLab")
  if (!Array.isArray(parent_ids) || !parent_ids.every((id) => typeof id === "string")) {
    throw new CheckError("Invalid GitLab commit response")
  }

  return parent_ids
}

const clis: Record<Platform, string> = { GitHub: "gh", GitLab: "glab" }

const request = async (
  platform: Platform,
  args: string[],
  signal: AbortSignal,
): Promise<unknown> => {
  const cli = clis[platform]

  let process: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    process = Bun.spawn([cli, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        GH_PROMPT_DISABLED: "1",
        GLAB_CHECK_UPDATE: "false",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
  } catch (error) {
    throw new CheckError(
      `Could not start ${cli}: ${error instanceof Error ? error.message : String(error)}`,
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

    if (signal.aborted) throw new CheckError(`${platform} check timed out`, true)
    if (exitCode !== 0) {
      const reason = stderr.trim() || `${cli} exited with code ${exitCode}`
      const retryable =
        /HTTP 5\d\d|HTTP 429|rate limit|connection|network|TLS handshake|timeout|timed out|temporary failure|unexpected EOF/i.test(
          reason,
        )
      throw new CheckError(reason, retryable)
    }

    try {
      return JSON.parse(stdout)
    } catch {
      throw new CheckError(`${cli} returned invalid JSON`)
    }
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

type Check = (options: Options, signal: AbortSignal) => Promise<Snapshot>

const checkGitHubPullRequest: Check = async (options, signal) => {
  const fields = ["state", "headRefOid"]
  if (options.until === "checks-passed") fields.push("statusCheckRollup")

  const args = ["pr", "view", options.url, "--json", fields.join(",")]
  return evaluatePullRequest(await request("GitHub", args, signal), options.until)
}

const gitlabApi = (options: Options) => {
  const url = new URL(options.url)
  const [project, resource] = url.pathname.slice(1).split("/-/")
  const get = (path: string, signal: AbortSignal) =>
    request(
      "GitLab",
      ["api", `projects/${encodeURIComponent(project)}/${path}`, "--hostname", url.hostname],
      signal,
    )

  return { resource, get }
}

const checkGitLabMergeRequest: Check = async (options, signal) => {
  const gitlab = gitlabApi(options)
  const mr = await gitlab.get(gitlab.resource, signal)

  const mergeCommit = options.until === "checks-passed" ? mergedResultCommit(mr) : undefined
  const parents = mergeCommit
    ? commitParents(await gitlab.get(`repository/commits/${mergeCommit}`, signal))
    : []

  return evaluateMergeRequest(mr, options.until, parents)
}

const checkGitLabPipeline: Check = async (options, signal) => {
  const gitlab = gitlabApi(options)
  return evaluatePipeline(await gitlab.get(gitlab.resource, signal))
}

const checks: Record<TargetName, Check> = {
  "github-pr": checkGitHubPullRequest,
  "gitlab-mr": checkGitLabMergeRequest,
  "gitlab-pipeline": checkGitLabPipeline,
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
    check = (options, signal) => checks[options.target](options, signal),
    report = (message: string) => console.error(message),
  }: {
    signal?: AbortSignal
    check?: Check
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

        progress(`Retrying ${targets[options.target].platform} check (${errors}/3): ${reason}`)
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
      JSON.stringify(
        Object.entries(targets).map(([name, { description }]) => ({ name, description })),
      ),
    )
    return 0
  }

  const [name, flag] = args
  if (isTarget(name) && args.length === 2 && (flag === "--help" || flag === "-h")) {
    console.log(targets[name].help)
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
