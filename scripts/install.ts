import { access, cp, mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { installMonitor } from "./install-monitor.ts"

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

const install = async (source: string) => {
  const instructions = await readFile(source, "utf8")
  const skills = await readdir(join(root, "skills"))
  await installMonitor()

  for (const target of targets) {
    const directory = home(target)
    const path = await target.file(directory)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await render(target.template, instructions))

    console.log(`${target.name}: ${await realpath(path)}`)

    for (const skill of skills) {
      const destination = join(directory, "skills", skill)
      await cp(join(root, "skills", skill), destination, { recursive: true })

      console.log(`${target.name} ${skill}: ${await realpath(destination)}`)
    }
  }
}

const source = process.argv[2] ? resolve(process.argv[2]) : join(root, "AGENTS.md")

await install(source)
