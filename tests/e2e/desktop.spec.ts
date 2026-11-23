import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("桌面启动、创建作品、编辑保存、版本保护、参考导入与重启", async () => {
  const data = await mkdtemp(join(tmpdir(), "gongzhuo-e2e-"));
  await mkdir("artifacts", { recursive: true });
  let app = await electron.launch({
    executablePath: process.env.STUDIO_ELECTRON_PATH,
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  let page = await app.firstWindow();
  await expect(
    page.getByRole("heading", { name: "每一个故事，都值得写完。" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/library.png" });
  await page
    .getByRole("button", { name: "新建作品", exact: true })
    .last()
    .click();
  await page.getByPlaceholder("给故事起一个名字").fill("雾港来信");
  await page
    .getByPlaceholder("一个人物、一个困境，或一个你一直想写的念头……")
    .fill("一名修表师收到一封来自明天的信，信中写着今夜将发生的失踪案。");
  await page.getByRole("button", { name: "创建作品" }).click();
  await expect(page.getByRole("dialog", { name: "创作配置" })).toBeVisible();
  await page.getByRole("button", { name: "保存配置" }).click();
  await page.getByRole("button", { name: "添加章节", exact: true }).click();
  const edit = page.getByRole("textbox", { name: "小说正文" });
  await edit.fill(
    "雾在凌晨三点漫进港口。\n\n沈砚关上修表铺的门时，看见门缝里多出一封信。",
  );
  await expect(page.getByText("已保存到本机", { exact: true })).toBeVisible();
  await expect(edit).toContainText("沈砚");
  await page.getByRole("button", { name: "草稿 · 标为正式" }).click();
  await expect(page.getByRole("button", { name: "正式正文" })).toBeVisible();
  await page.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "版本历史" })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.screenshot({ path: "artifacts/studio.png" });
  await page.getByRole("button", { name: "模型与设置", exact: true }).click();
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await page.getByLabel("显示名称").fill("独立主笔");
  await page.getByLabel("模型 ID", { exact: true }).fill("my-model");
  await page.getByLabel(/^API 密钥/).fill("e2e-not-a-real-key");
  await page.getByRole("button", { name: "保存模型", exact: true }).click();
  await expect(page.getByRole("heading", { name: "独立主笔" })).toBeVisible();
  await page.screenshot({ path: "artifacts/settings.png" });
  const snapshot = await page.evaluate(() => window.studio.call("snapshot"));
  expect(JSON.stringify(snapshot)).not.toContain("e2e-not-a-real-key");
  await page.getByRole("button", { name: "参考与方法", exact: true }).click();
  await page.getByRole("button", { name: "粘贴参考", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("港口短篇结构样例");
  await page
    .getByLabel("参考正文", { exact: true })
    .fill(
      "开头用一封来信制造悬念，中段逐步揭开人物动机，结尾让失踪案和来信的时间线相遇。",
    );
  await page.getByRole("button", { name: "保存参考资料" }).click();
  await expect(
    page.getByRole("heading", { name: "港口短篇结构样例" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/references.png" });
  await app.close();
  expect(
    (await readFile(join(data, "credentials.bin"))).includes(
      Buffer.from("e2e-not-a-real-key"),
    ),
  ).toBe(false);
  app = await electron.launch({
    executablePath: process.env.STUDIO_ELECTRON_PATH,
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "每一个故事，都值得写完。" })
    .waitFor();
  expect(
    (await page.evaluate(() => window.studio.call("snapshot"))).models[0]
      .hasKey,
  ).toBe(true);
  await page
    .getByRole("button", { name: /雾港来信/ })
    .first()
    .click();
  await expect(page.getByRole("textbox", { name: "小说正文" })).toContainText(
    "沈砚",
  );
  await app.close();
});
