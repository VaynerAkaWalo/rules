import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

type Target = {
  name: string
  file: (directory: string) => Promise<string>
  homeEnv?: string
  homeFallback?: () => string | undefined
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
    file: async (directory) => join(directory, "AGENTS.md"),
    homeEnv: "CURSOR_CONFIG_DIR",
    homeFallback: () => {
      const xdg = process.env.XDG_CONFIG_HOME?.trim()
      return xdg ? join(xdg, "cursor") : undefined
    },
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

const install = async (source: string) => {
  const instructions = await readFile(source, "utf8")

  for (const target of targets) {
    const directory = home(target)
    const path = await target.file(directory)

    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, instructions)

    console.log(`${target.name}: ${await realpath(path)}`)
  }
}

const source = process.argv[2] ? resolve(process.argv[2]) : join(root, "AGENTS.md")

await install(source)
