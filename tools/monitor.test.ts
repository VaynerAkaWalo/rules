import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { evaluatePullRequest, parseArgs } from "./monitor.ts"

const url = "https://github.com/owner/repo/pull/123"
const headSha = "a".repeat(40)
const bun = process.execPath
const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const pr = (state = "OPEN", statusCheckRollup: unknown[] = [], sha = headSha) => ({
  state,
  headRefOid: sha,
  statusCheckRollup,
})

const check = (name: string, conclusion: string, status = "COMPLETED") => ({
  __typename: "CheckRun",
  name,
  conclusion,
  status,
})

type Response = { value?: unknown; stdout?: string; stderr?: string; code?: number; delay?: number }

const start = async (responses: Response[], args: string[] = [], until = "merged") => {
  const directory = await mkdtemp(join(tmpdir(), "rules-monitor-"))
  directories.push(directory)

  await writeFile(join(directory, "responses.json"), JSON.stringify(responses))
  await writeFile(
    join(directory, "gh"),
    `#!/usr/bin/env bun
const directory = Bun.env.MONITOR_FIXTURE
const counter = Bun.file(directory + "/counter")
const index = await counter.exists() ? Number(await counter.text()) : 0
await Bun.write(counter, String(index + 1))
await Bun.write(directory + "/pid", String(process.pid))
const responses = await Bun.file(directory + "/responses.json").json()
const response = responses[Math.min(index, responses.length - 1)]
if (response.delay) await Bun.sleep(response.delay)
if (response.value !== undefined) console.log(JSON.stringify(response.value))
if (response.stdout) console.log(response.stdout)
if (response.stderr) console.error(response.stderr)
process.exitCode = response.code ?? 0
`,
    { mode: 0o755 },
  )

  const process = Bun.spawn(
    [
      bun,
      resolve(import.meta.dir, "monitor.ts"),
      "github-pr",
      url,
      "--until",
      until,
      "--interval",
      "1ms",
      "--timeout",
      "3s",
      ...args,
    ],
    {
      env: { ...Bun.env, PATH: `${directory}:${Bun.env.PATH}`, MONITOR_FIXTURE: directory },
      stdout: "pipe",
      stderr: "pipe",
    },
  )

  const done = async () => {
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])

    expect(stdout.trim().split("\n")).toHaveLength(1)
    return { result: JSON.parse(stdout), stderr, code, directory }
  }

  return { process, done, directory }
}

describe("arguments", () => {
  test("parses explicit conditions, duration units, and defaults", () => {
    expect(parseArgs(["github-pr", `${url}/`, "--until", "merged", "--timeout", "1.5h"])).toEqual({
      url,
      until: "merged",
      timeout: 5_400_000,
      interval: 30_000,
      checkTimeout: 20_000,
    })
  })

  const invalidArgs = [
    ["github-pr", url],
    ["github-pr", "https://evil.example/pull/123", "--until", "merged"],
    ["github-pr", "https://github.com/owner/repo/pull/123?x=1", "--until", "merged"],
    ["github-pr", url, "--until", "unknown"],
    ["github-pr", url, "--until", "merged", "--timeout", "0s"],
    ["github-pr", url, "--until", "merged", "--interval", "100000h"],
    ["github-pr", url, "--until", "merged", "--unexpected"],
  ]

  for (const args of invalidArgs) {
    test(`rejects invalid arguments ${args.join(" ")}`, () => {
      expect(() => parseArgs(args)).toThrow()
    })
  }
})

describe("GitHub conditions", () => {
  test("distinguishes open, merged, and closed PRs", () => {
    expect(evaluatePullRequest(pr(), "merged").status).toBe("pending")
    expect(evaluatePullRequest(pr("MERGED"), "merged").status).toBe("ready")
    expect(evaluatePullRequest(pr("CLOSED"), "merged").status).toBe("failed")
  })

  test("waits for checks to appear and finish", () => {
    expect(evaluatePullRequest(pr(), "checks-passed").status).toBe("pending")
    expect(
      evaluatePullRequest(pr("OPEN", [check("build", "", "IN_PROGRESS")]), "checks-passed").status,
    ).toBe("pending")
  })

  test("accepts successful, neutral, skipped, and legacy checks", () => {
    const checks = [
      check("build", "SUCCESS"),
      check("optional", "NEUTRAL"),
      check("docs", "SKIPPED"),
      { __typename: "StatusContext", context: "legacy", state: "SUCCESS" },
    ]
    expect(evaluatePullRequest(pr("OPEN", checks), "checks-passed").status).toBe("ready")
  })

  test.each(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STALE", "STARTUP_FAILURE"])(
    "returns failures for %s even with pending checks",
    (state) => {
      const checks = [check("build", state), check("test", "", "QUEUED")]
      expect(evaluatePullRequest(pr("OPEN", checks), "checks-passed")).toMatchObject({
        status: "failed",
        reason: "Checks failed: build",
        headSha,
      })
    },
  )

  test("rejects malformed or unknown states instead of declaring success", () => {
    expect(() => evaluatePullRequest({}, "merged")).toThrow()
    expect(() =>
      evaluatePullRequest(pr("OPEN", [check("build", "SUCCESS", "INVALID")]), "checks-passed"),
    ).toThrow()
    expect(() =>
      evaluatePullRequest(pr("OPEN", [check("build", "NEW_STATE")]), "checks-passed"),
    ).toThrow()
    expect(() =>
      evaluatePullRequest({ ...pr(), statusCheckRollup: null }, "checks-passed"),
    ).toThrow()
  })
})

describe("monitor CLI", () => {
  test("polls until merge with one terminal JSON result", async () => {
    const run = await start([{ value: pr() }, { value: pr() }, { value: pr("MERGED") }])
    const { code, result, stderr } = await run.done()

    expect(code).toBe(0)
    expect(result).toMatchObject({ status: "ready", url, until: "merged", headSha })
    expect(stderr.trim().split("\n")).toHaveLength(1)
    expect(await readFile(join(run.directory, "counter"), "utf8")).toBe("3")
  })

  test("tracks a new head and evaluates its checks", async () => {
    const newHead = "b".repeat(40)
    const run = await start(
      [
        { value: pr("OPEN", [check("build", "", "IN_PROGRESS")]) },
        { value: pr("OPEN", [], newHead) },
        { value: pr("OPEN", [check("build", "SUCCESS")], newHead) },
      ],
      [],
      "checks-passed",
    )

    const { code, result, stderr } = await run.done()
    expect(code).toBe(0)
    expect(result.headSha).toBe(newHead)
    expect(stderr).toContain(newHead)
  })

  test("returns failure for a closed PR", async () => {
    const run = await start([{ value: pr("CLOSED") }])
    const { code, result } = await run.done()
    expect(code).toBe(1)
    expect(result.status).toBe("failed")
  })

  test("times out with the last observation", async () => {
    const run = await start([{ value: pr() }], ["--timeout", "200ms", "--interval", "1s"])
    const { code, result } = await run.done()
    expect(code).toBe(124)
    expect(result).toMatchObject({ status: "timeout", headSha })
    expect(result.reason).toContain("Waiting for pull request to merge")
  })

  test("authentication failures stop immediately", async () => {
    const run = await start([{ code: 1, stderr: "HTTP 401: Bad credentials" }])
    const { code, result } = await run.done()
    expect(code).toBe(2)
    expect(result.status).toBe("error")
    expect(await readFile(join(run.directory, "counter"), "utf8")).toBe("1")
  })

  test("malformed output stops immediately", async () => {
    const run = await start([{ stdout: "not JSON" }])
    const { code, result } = await run.done()
    expect(code).toBe(2)
    expect(result.reason).toBe("gh returned invalid JSON")
    expect(await readFile(join(run.directory, "counter"), "utf8")).toBe("1")
  })

  test("recovers from transient errors and bounds consecutive retries", async () => {
    const recovered = await start([
      { code: 1, stderr: "HTTP 503: Service unavailable" },
      { value: pr("MERGED") },
    ])
    expect((await recovered.done()).code).toBe(0)

    const failed = await start([{ code: 1, stderr: "HTTP 503: Service unavailable" }])
    expect((await failed.done()).code).toBe(2)
    expect(await readFile(join(failed.directory, "counter"), "utf8")).toBe("3")
  })

  test("kills hung checks at the per-check deadline", async () => {
    const run = await start([{ value: pr(), delay: 5_000 }], ["--check-timeout", "80ms"])
    const { code, result } = await run.done()

    expect(code).toBe(2)
    expect(result.reason).toContain("timed out")
    const pid = Number(await readFile(join(run.directory, "pid"), "utf8"))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  test("overall deadline interrupts a hung check", async () => {
    const run = await start([{ value: pr(), delay: 5_000 }], ["--timeout", "100ms"])
    const { code, result } = await run.done()
    expect(code).toBe(124)
    expect(result.status).toBe("timeout")
  })

  test("cancellation interrupts polling and emits its result", async () => {
    const run = await start([{ value: pr() }], ["--interval", "10s"])
    const timer = setTimeout(() => run.process.kill("SIGINT"), 200)

    try {
      const { code, result } = await run.done()
      expect(code).toBe(130)
      expect(result.status).toBe("cancelled")
    } finally {
      clearTimeout(timer)
    }
  })

  test("cancellation kills an in-flight check", async () => {
    const run = await start([{ value: pr(), delay: 5_000 }])
    const timer = setTimeout(() => run.process.kill("SIGTERM"), 200)

    try {
      const { code, result } = await run.done()
      expect(code).toBe(130)
      expect(result.status).toBe("cancelled")
      const pid = Number(await readFile(join(run.directory, "pid"), "utf8"))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      clearTimeout(timer)
    }
  })

  test("invalid input emits JSON without invoking gh", async () => {
    const run = await start([], ["--until", "unknown"])
    const { code, result } = await run.done()
    expect(code).toBe(2)
    expect(result.status).toBe("error")
    expect(await Bun.file(join(run.directory, "counter")).exists()).toBe(false)
  })
})

test("installer deploys monitor skills and preserves the Codex override selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rules-install-"))
  directories.push(directory)

  const homes: Record<string, string> = Object.fromEntries(
    ["claude", "codex", "cursor", "grok"].map((name) => [name, join(directory, name)]),
  )
  await mkdir(homes.codex, { recursive: true })
  await writeFile(join(homes.codex, "AGENTS.override.md"), "old instructions")

  const process = Bun.spawn([bun, resolve(import.meta.dir, "../scripts/install.ts")], {
    env: {
      ...Bun.env,
      CLAUDE_CONFIG_DIR: homes.claude,
      CODEX_HOME: homes.codex,
      CURSOR_HOME: homes.cursor,
      GROK_HOME: homes.grok,
    },
    stdout: "pipe",
    stderr: "pipe",
  })

  await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()])
  expect(await process.exited).toBe(0)

  for (const name of ["claude", "codex", "cursor", "grok"]) {
    const home = homes[name]
    expect(await Bun.file(join(home, "skills/monitor/SKILL.md")).exists()).toBe(true)
    const installed = Bun.spawn([bun, join(home, "tools/monitor.ts"), "--help"], { stdout: "pipe" })
    expect(await new Response(installed.stdout).text()).toContain("checks-passed")
    expect(await installed.exited).toBe(0)
  }

  expect(await Bun.file(join(homes.codex, "AGENTS.md")).exists()).toBe(false)
  expect(await readFile(join(homes.codex, "AGENTS.override.md"), "utf8")).toContain(
    "# Agent guidelines",
  )
  expect(await readFile(join(homes.cursor, "rules/global.mdc"), "utf8")).toContain(
    "alwaysApply: true",
  )
})
