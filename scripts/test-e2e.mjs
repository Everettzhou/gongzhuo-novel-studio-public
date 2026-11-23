import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

// OneDrive can mark hydrated files as reparse points. Playwright deliberately
// skips symlink tests, so discover tests from a byte-for-byte temporary copy.
const root = process.cwd();
const staging = await mkdtemp(join(tmpdir(), "gongzhuo-e2e-source-"));
for (const directory of ["tests/e2e", "electron", "src"]) {
  await mkdir(join(staging, directory), { recursive: true });
  for (const name of await readdir(join(root, directory))) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    await writeFile(
      join(staging, directory, name),
      await readFile(join(root, directory, name)),
    );
  }
}
await symlink(
  join(root, "node_modules"),
  join(staging, "node_modules"),
  "junction",
);
const config = `import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',timeout:90000,workers:1,
outputDir:${JSON.stringify(join(root, "test-results"))},use:{trace:'retain-on-failure'},
reporter:[['list'],['html',{open:'never',outputFolder:${JSON.stringify(join(root, "playwright-report"))}}]]});`;
await writeFile(join(staging, "playwright.config.ts"), config);
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    join(staging, "playwright.config.ts"),
    ...process.argv.slice(2),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STUDIO_APP_ROOT: root },
    windowsHide: true,
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
