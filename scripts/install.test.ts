import { afterAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const bun = process.execPath
const directories: string[] = []
const agents = ["claude", "codex", "cursor", "grok"]

afterAll(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
})

const createHomes = async () => {
  const directory = await mkdtemp(join(tmpdir(), "rules-install-"))
  directories.push(directory)

  return Object.fromEntries(agents.map((name) => [name, join(directory, name)])) as Record<
    string,
    string
  >
}

const runInstall = async (homes: Record<string, string>) => {
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
}

test("installer deploys rules and skills and preserves the Codex override selection", async () => {
  const homes = await createHomes()
  await mkdir(homes.codex, { recursive: true })
  await writeFile(join(homes.codex, "AGENTS.override.md"), "old instructions")

  await runInstall(homes)

  for (const name of agents) {
    const home = homes[name]
    for (const skill of ["bro", "brothers-in-arms", "bugfix", "on-behalf", "reflect"]) {
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

test("installer removes skills the repo used to have and keeps skills from elsewhere", async () => {
  const homes = await createHomes()
  const skills = join(homes.claude, "skills")

  for (const skill of ["skill-authoring", "foreign-skill"]) {
    await mkdir(join(skills, skill), { recursive: true })
    await writeFile(join(skills, skill, "SKILL.md"), skill)
  }

  await runInstall(homes)

  expect(await Bun.file(join(skills, "skill-authoring", "SKILL.md")).exists()).toBe(false)
  expect(await Bun.file(join(skills, "foreign-skill", "SKILL.md")).exists()).toBe(true)
})
