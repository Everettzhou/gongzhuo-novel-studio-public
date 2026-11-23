import { extractFile } from "@electron/asar";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const archive = resolve("release/win-unpacked/resources/app.asar");
const hashes = {};
for (const name of ["main.cjs", "preload.cjs", "worker.cjs"]) {
  const file = `dist-electron/${name}`;
  const current = await readFile(resolve(file));
  const packed = extractFile(archive, file);
  assert(
    current.equals(packed),
    `Packaged ${name} differs from the final build`,
  );
  hashes[file] = createHash("sha256").update(packed).digest("hex");
}
const file = resolve("release/Gongzhuo-Setup-0.2.0.exe");
const report = {
  at: new Date().toISOString(),
  result: "passed",
  packagedEntrypointsMatchBuild: true,
  hashes,
  installer: {
    file,
    bytes: (await stat(file)).size,
    sha256: createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
  },
};
await writeFile(
  join(root, "artifacts/package-validation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
