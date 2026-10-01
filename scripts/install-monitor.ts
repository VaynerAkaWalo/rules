import { chmod, mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"

export const installMonitor = async () => {
  const build = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../tools/monitor.ts")],
    target: "bun",
  })
  if (!build.success) throw new AggregateError(build.logs, "Could not build monitor")

  const directory = process.env.MONITOR_BIN_DIR?.trim() || join(homedir(), ".local", "bin")
  const path = resolve(directory, "monitor")
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `#!/usr/bin/env bun\n${await build.outputs[0].text()}`)
  await chmod(path, 0o755)

  console.log(`monitor: ${path}`)
  const entries = (process.env.PATH ?? "").split(delimiter).map((entry) => resolve(entry))
  if (!entries.includes(dirname(path))) {
    console.log(`Add ${dirname(path)} to PATH for monitor to be available in agent shells.`)
  }

  return path
}

if (import.meta.main) await installMonitor()
