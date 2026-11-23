import { createServer } from "node:http";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("导入 Skill、预览保存、作品角色绑定与重启持久化", async () => {
  const data = await mkdtemp(join(tmpdir(), "gongzhuo-skills-"));
  let app = await electron.launch({
    executablePath: process.env.STUDIO_ELECTRON_PATH,
    args: ["."],
    env: { ...process.env, STUDIO_DATA_DIR: data },
  });
  try {
    let page = await app.firstWindow();
    await page.getByRole("button", { name: "模型与设置", exact: true }).click();
    await page
      .getByLabel("导入 Skill")
      .setInputFiles({
        name: "SKILL.md",
        mimeType: "text/markdown",
        buffer: Buffer.from(
          "---\nname: 悬念节奏\ndescription: 写作节奏\n---\n每个场景留下一个待解的问题。",
        ),
      });
    await expect(page.getByLabel("Skill 名称")).toHaveValue("悬念节奏");
    await page.getByRole("button", { name: "保存 Skill", exact: true }).click();
    await expect(
      page.locator("strong").filter({hasText:"悬念节奏 · v1"}),
    ).toBeVisible();
    const project = await page.evaluate(async () =>
      window.studio.call<any>("project.create", { title: "Skills 测试" }),
    );
    const snap = await page.evaluate(async () =>
      window.studio.call<any>("snapshot"),
    );
    await page.evaluate(
      async ({ p, s }) =>
        window.studio.call("project.update", {
          id: p.id,
          revision: p.revision,
          patch: { skillBindings: { writer: [s.id] } },
        }),
      { p: project, s: snap.skills[0] },
    );
    await app.close(); app = await electron.launch({executablePath:process.env.STUDIO_ELECTRON_PATH,args:["."],env:{...process.env,STUDIO_DATA_DIR:data}}); page = await app.firstWindow(); await expect(page.getByRole("button",{name:"模型与设置",exact:true})).toBeVisible();
    const restored = await page.evaluate(
      async (id) => window.studio.call<any>("project.detail", { id }),
      project.id,
    );
    expect(restored.project.skillBindings.writer).toEqual([snap.skills[0].id]);
    await page.getByRole("button", { name: "模型与设置", exact: true }).click();
    const server=createServer(async(req,res)=>{
      let body=""; for await(const chunk of req) body+=chunk;
      const messages=JSON.parse(body).messages;
      const sample=JSON.parse(messages[1].content.split("\n").at(-1));
      const answer=JSON.stringify({name:"悬念节奏升级",content:"先展示异常，再让人物作出有代价的决定。",reason:"源自开头节选，效果尚待试读验证。",evidenceIds:[sample.evidence.chapters[0].id]});
      res.writeHead(200,{"Content-Type":"text/event-stream"});
      res.end(`data: ${JSON.stringify({choices:[{delta:{content:answer},finish_reason:null}]})}\n\ndata: ${JSON.stringify({choices:[{delta:{},finish_reason:"stop"}]})}\n\ndata: [DONE]\n\n`);
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    try {
      const port=(server.address() as any).port;
      await page.evaluate(async({projectId,port})=>{
        const m=await window.studio.call<any>("model.save",{name:"复盘模拟",protocol:"openai",baseUrl:`http://127.0.0.1:${port}/v1`,model:"mock",contextLimit:32000,outputLimit:4000,key:"mock"});
        const d=await window.studio.call<any>("project.detail",{id:projectId});
        await window.studio.call("project.update",{id:projectId,revision:d.project.revision,patch:{roles:{...d.project.roles,planner:m.id}}});
        const c=await window.studio.call<any>("chapter.create",{projectId,title:"开头"});
        await window.studio.call("chapter.save",{id:c.id,baseVersion:c.version,text:"门锁被换了，他决定留下来调查。"});
      },{projectId:project.id,port});
      await page.getByLabel("复盘作品").selectOption(project.id);
      await page.getByLabel("更新目标 Skill").selectOption(snap.skills[0].id);
      await page.getByRole("button",{name:"从写作记录提炼 Skill"}).click();
      await page.getByText("待采纳：悬念节奏升级 · 更新").click();
      await expect(page.getByLabel("建议版本")).toHaveValue("先展示异常，再让人物作出有代价的决定。");
      await page.getByRole("button",{name:"采纳 Skill 建议"}).click();
      await expect(page.locator("strong").filter({hasText:"悬念节奏升级 · v2"})).toBeVisible();
    } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
    await page.screenshot({
      path: "artifacts/skills-library.png",
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});

