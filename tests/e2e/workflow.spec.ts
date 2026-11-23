import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { importBuffer } from "../../electron/documents";
test("桌面调用本地模拟 API、双审稿、流式正文与实际 DOCX/PDF/TXT 导出", async () => {
  const calls: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    const system = parsed.messages[0]?.content || "";
    const prompt = parsed.messages.at(-1)?.content || "";
    calls.push(prompt);
    let content = "";
    if (system.includes('"outline"'))
      content = JSON.stringify({
        outline: "一封来信让修表师重返港口，最终发现父亲留下的证据。",
        facts: [
          {
            kind: "人物",
            name: "沈砚",
            detail: "修表师，谨慎而执着。",
            aliases: [],
            planned: false,
          },
        ],
        chapters: [
          {
            title: "雾港来信",
            volume: "",
            beats: "收到来信，追查线索，解开误会。",
            scenes: ["开篇悬念：收到来信", "终篇：找到真相"],
          },
        ],
      });
    else if (system.includes('"analysis"'))
      content = JSON.stringify({
        analysis: "仅分析节选。片段1以意外来信建立悬念，证据位置为开篇。",
        methods: "用异常事件开启故事，逐步释放线索，结尾回应最初的问题。",
      });
    else if (system.includes('"issues"'))
      content = JSON.stringify({
        summary:
          "模拟审查已完成：时间线与设定一致。此为软件验收数据，不代表真实模型评价。",
        issues: [],
      });
    else if (system.includes('"facts"'))
      content = JSON.stringify({
        summary: "沈砚在港口找到父亲留下的信。",
        facts: [
          {
            kind: "伏笔",
            name: "来信",
            detail: "证据：门缝里多出一封信。",
            aliases: [],
            planned: false,
          },
        ],
      });
    else
      content = (
        "雾在凌晨三点漫进港口。沈砚关上修表铺的门时，看见门缝里多出一封信。\n\n" +
        "信纸边缘留着潮水的气味，邮戳上的日期却是明天。他沿着空荡的街道走向灯塔，想起了父亲讲过的故事。\n\n".repeat(
          100,
        )
      ).slice(0, 4300);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (let i = 0; i < content.length; i += 200) {
      res.write(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content: content.slice(i, i + 200) } }],
          }) +
          "\n\n",
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    res.end(
      "data: " +
        JSON.stringify({
          usage: { prompt_tokens: 100, completion_tokens: 200 },
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const directory = await mkdtemp(join(tmpdir(), "gongzhuo-flow-"));
  await mkdir("artifacts", { recursive: true });
  const app = await electron.launch({
    executablePath: process.env.STUDIO_ELECTRON_PATH,
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: directory },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "每一个故事，都值得写完。" }),
    ).toBeVisible();
    const project = await page.evaluate(
      async ({ port }) => {
        const model = await window.studio.call("model.save", {
          name: "模拟接口 · 仅验收",
          protocol: "openai",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          model: "fixture",
          key: "fixture-not-real",
          contextLimit: 32000,
          outputLimit: 4096,
        });
        return window.studio.call("project.create", {
          title: "雾港来信 · 模拟验收",
          mode: "short",
          targetWords: 8000,
          idea: "修表师收到来自明天的信。",
          roles: {
            planner: model.id,
            writer: model.id,
            reviewers: [model.id, model.id],
            plannerPrompt: "",
            writerPrompt: "",
            reviewerPrompts: ["逻辑", "人物与节奏"],
          },
        });
      },
      { port },
    );
    await page
      .getByRole("button", { name: /雾港来信 · 模拟验收/ })
      .first()
      .click();
    await page.getByRole("button", { name: "创作整篇", exact: true }).click();
    await expect(page.getByText("已完成", { exact: true })).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByRole("textbox", { name: "小说正文" })).toContainText(
      "沈砚",
    );
    expect(calls.filter((x) => x.includes("检查因果"))).toHaveLength(2);
    await page.screenshot({ path: "artifacts/generated-story.png" });
    for (const format of ["docx", "pdf", "txt"]) {
      const output = resolve(`artifacts/验收模拟小说.${format}`);
      await app.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath,
        })) as any;
      }, output);
      await page.getByRole("button", { name: "导出", exact: true }).click();
      await page.getByLabel("格式", { exact: true }).selectOption(format);
      await page.getByRole("button", { name: "选择保存位置" }).click();
      await expect(
        page.getByRole("dialog", { name: "导出正式正文" }),
      ).not.toBeVisible({ timeout: 30000 });
      const bytes = await readFile(output);
      expect(bytes.length).toBeGreaterThan(1000);
      if (format === "docx")
        expect(
          (await importBuffer(bytes, ".docx")).map((x) => x.text).join(""),
        ).toContain("沈砚");
      if (format === "pdf")
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(
          1,
        );
    }
    const snap = await page.evaluate(() => window.studio.call("snapshot"));
    expect(JSON.stringify(snap)).not.toContain("fixture-not-real");
    const detail = await page.evaluate(
      (id) => window.studio.call("project.detail", { id }),
      project.id,
    );
    expect(detail.chapters[0].summaryVersion).toBe(detail.chapters[0].version);
    const learning = await page.evaluate(async (modelId) => {
      const ref = await window.studio.call("reference.save", {
        title: "参考学习模拟验收",
        text: "陌生人带来一封来自未来的信。只提供此节选。",
        scope: "excerpt",
      });
      return window.studio.call("reference.analyze", {
        ids: [ref.id],
        modelId,
      });
    }, snap.models[0].id);
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (id) => window.studio.call("run.get", { id }),
              learning.id,
            )
          ).status,
      )
      .toBe("completed");
    await page.getByRole("button", { name: "参考与方法", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "参考学习模拟验收", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("参考学习任务历史")).toBeVisible();
    await page.getByRole("button", { name: /写作模板/ }).click();
    await expect(
      page.getByRole("heading", { name: "参考学习模拟验收 · 写作方法" }),
    ).toBeVisible();
    await page.screenshot({ path: "artifacts/learned-template.png" });
  } finally {
    await app.close();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  }
});
