import { access, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

type Target = {
  name: string
  file: (directory: string) => Promise<string>
  homeEnv?: string
  homeFallback?: () => string | undefined
  template?: string
}

const root = resolve(import.meta.dir, "..")

const exists = async (path: string) => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const targets: Target[] = [
  {
    name: "claude",
    file: async (directory) => join(directory, "CLAUDE.md"),
    homeEnv: "CLAUDE_CONFIG_DIR",
  },
  {
    name: "codex",
    file: async (directory) => {
      const override = join(directory, "AGENTS.override.md")
      return (await exists(override)) ? override : join(directory, "AGENTS.md")
    },
    homeEnv: "CODEX_HOME",
  },
  {
    name: "cursor",
    file: async (directory) => join(directory, "rules", "global.mdc"),
    homeEnv: "CURSOR_HOME",
    template: "cursor.mdc",
  },
  {
    name: "grok",
    file: async (directory) => join(directory, "AGENTS.md"),
    homeEnv: "GROK_HOME",
  },
]

const home = (target: Target) => {
  const override = target.homeEnv ? process.env[target.homeEnv]?.trim() : undefined
  if (override) return override

  return target.homeFallback?.() ?? join(homedir(), `.${target.name}`)
}

const render = async (template: string | undefined, instructions: string) => {
  if (!template) return instructions

  const path = join(import.meta.dir, "templates", template)
  const text = await readFile(path, "utf8")

  return `${text.replaceAll("{{instructions}}", instructions.trimEnd())}\n`
}

const manifest = ".rules-skills.json"

const installedSkills = async (directory: string): Promise<string[]> => {
  const path = join(directory, manifest)
  if (!(await exists(path))) return []

  return JSON.parse(await readFile(path, "utf8"))
}

const install = async (source: string) => {
  const instructions = await readFile(source, "utf8")
  const skills = await readdir(join(root, "skills"))

  for (const target of targets) {
    const directory = home(target)
    const path = await target.file(directory)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await render(target.template, instructions))

    console.log(`${target.name}: ${await realpath(path)}`)

    const skillsDirectory = join(directory, "skills")
    const stale = (await installedSkills(skillsDirectory)).filter((skill) => !skills.includes(skill))

    for (const skill of stale) {
      await rm(join(skillsDirectory, skill), { recursive: true, force: true })

      console.log(`${target.name} ${skill}: removed`)
    }

    for (const skill of skills) {
      const destination = join(skillsDirectory, skill)
      await rm(destination, { recursive: true, force: true })
      await cp(join(root, "skills", skill), destination, { recursive: true })

      console.log(`${target.name} ${skill}: ${await realpath(destination)}`)
    }

    await writeFile(join(skillsDirectory, manifest), `${JSON.stringify(skills, null, 2)}\n`)
  }
}

const source = process.argv[2] ? resolve(process.argv[2]) : join(root, "instructions.md")

await install(source)
