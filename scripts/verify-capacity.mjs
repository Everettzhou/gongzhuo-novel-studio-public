import { _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { PDFDocument } from "pdf-lib";
import mammoth from "mammoth";
import assert from "node:assert/strict";

// Tests the packaged program through its public bridge, with no model credentials.
// Only the native save dialog is replaced, so exports exercise production code.
const executablePath = resolve(
  process.argv[2] || "release/win-unpacked/共著.exe",
);
const dataDirectory = await mkdtemp(join(tmpdir(), "gongzhuo-capacity-"));
const out = resolve("artifacts");
await mkdir(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  executablePath,
  dataDirectory,
  metrics: {},
};
const start = performance.now();
const app = await electron.launch({
  executablePath,
  args: [],
  timeout: 60000,
  env: {
    ...process.env,
    PATH: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
    STUDIO_DATA_DIR: dataDirectory,
  },
});
try {
  const page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "每一个故事，都值得写完。" })
    .waitFor();
  report.metrics.packagedStartMs = Math.round(performance.now() - start);
  report.runtime = await app.evaluate(() => process.versions);
  const parts = Array.from({ length: 400 }, (_, i) => ({
    title: `第${i + 1}章 容量验证`,
    text:
      `独立检索标记${String(i + 1).padStart(4, "0")}。\n\n` +
      "潮水退去，林舟走过港口。他把信收进旧外套，故事还在继续。\n\n"
        .repeat(100)
        .slice(0, 2800) +
      `\n\n末尾完整性标记${String(i + 1).padStart(4, "0")}。`,
  }));
  report.chapters = parts.length;
  report.characters = parts.reduce(
    (n, p) => n + p.text.replace(/\s/g, "").length,
    0,
  );
  assert(report.characters >= 1000000);
  const project = await page.evaluate(() =>
    window.studio.call("project.create", {
      title: "百万字容量验证 · 测试资料",
      mode: "long",
    }),
  );
  let tick = performance.now();
  await page.evaluate(
    ({ id, parts }) =>
      window.studio.call("import.commit", { projectId: id, parts }),
    { id: project.id, parts },
  );
  report.metrics.importMs = Math.round(performance.now() - tick);
  tick = performance.now();
  const detail = await page.evaluate(
    (id) => window.studio.call("project.detail", { id }),
    project.id,
  );
  report.metrics.loadIndexMs = Math.round(performance.now() - tick);
  assert.equal(detail.chapters.length, 400);
  assert(detail.chapters.every((c) => !("text" in c)));
  tick = performance.now();
  const hits = await page.evaluate(
    (id) =>
      window.studio.call("project.search", { id, query: "独立检索标记0400" }),
    project.id,
  );
  report.metrics.searchMs = Math.round(performance.now() - tick);
  assert.equal(hits.length, 1);
  await page
    .getByRole("button", { name: /百万字容量验证/ })
    .first()
    .click();
  await page.getByRole("textbox", { name: "小说正文" }).waitFor();
  await page.screenshot({ path: join(out, "capacity-desktop.png") });
  report.exports = {};
  for (const format of ["txt", "docx", "pdf"]) {
    const path = join(out, `百万字容量验证.${format}`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path);
    tick = performance.now();
    await page.evaluate(
      ({ projectId, format }) =>
        window.studio.call("export.save", { projectId, format }),
      { projectId: project.id, format },
    );
    const bytes = await readFile(path);
    report.exports[format] = {
      path,
      bytes: bytes.length,
      elapsedMs: Math.round(performance.now() - tick),
    };
    if (format === "txt") {
      const text = bytes.toString("utf8");
      for (const p of parts)
        assert(text.includes(p.text), `TXT missing ${p.title}`);
    } else if (format === "docx") {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      for (const p of parts)
        assert(
          value.replace(/\s/g, "").includes(p.text.replace(/\s/g, "")),
          `DOCX missing ${p.title}`,
        );
    } else {
      const pdf = await PDFDocument.load(bytes);
      report.exports.pdf.pages = pdf.getPageCount();
      assert(pdf.getPageCount() >= 400);
    }
    console.log(
      `${format}: ${report.exports[format].elapsedMs} ms / ${bytes.length} bytes`,
    );
  }
  report.databaseBytes = (await stat(join(dataDirectory, "studio.db"))).size;
  report.result = "passed";
} finally {
  await app.close();
  await writeFile(
    join(out, "capacity-report.json"),
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
