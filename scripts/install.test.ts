import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const bun = process.execPath
const directories: string[] = []

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

test("installer deploys rules and skills and preserves the Codex override selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rules-install-"))
  directories.push(directory)

  const homes: Record<string, string> = Object.fromEntries(
    ["claude", "codex", "cursor", "grok"].map((name) => [name, join(directory, name)]),
  )
  await mkdir(homes.codex, { recursive: true })
  await writeFile(join(homes.codex, "AGENTS.override.md"), "old instructions")

  const env = {
    ...Bun.env,
    CLAUDE_CONFIG_DIR: homes.claude,
    CODEX_HOME: homes.codex,
    CURSOR_HOME: homes.cursor,
    GROK_HOME: homes.grok,
  }

  const process = Bun.spawn([bun, resolve(import.meta.dir, "../scripts/install.ts")], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  })

  await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text()])
  expect(await process.exited).toBe(0)

  for (const name of ["claude", "codex", "cursor", "grok"]) {
    const home = homes[name]
    for (const skill of ["bro", "brothers-in-arms", "on-behalf"]) {
      expect(await Bun.file(join(home, "skills", skill, "SKILL.md")).exists()).toBe(true)
    }
  }

  expect(await Bun.file(join(homes.codex, "AGENTS.md")).exists()).toBe(false)
  expect(await readFile(join(homes.codex, "AGENTS.override.md"), "utf8")).toContain(
    "# Agent guidelines",
  )
  expect(await readFile(join(homes.cursor, "rules/global.mdc"), "utf8")).toContain(
    "alwaysApply: true",
  )
})
