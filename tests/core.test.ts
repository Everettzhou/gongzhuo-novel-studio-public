import { afterEach, describe, it, expect, vi } from "vitest";
import { Store, now, id } from "../electron/store";
import { Service } from "../electron/service";
import { Engine, splitText } from "../electron/engine";
import {
  generate,
  sse,
  ApiError,
  type Generation,
} from "../electron/providers";
import {
  isPublicIP,
  resolvePublic,
  extractArticle,
  searchReferences,
} from "../electron/references";
import * as referenceNetwork from "../electron/references";
import {
  splitChapters,
  importBuffer,
  exportDocx,
  printHTML,
} from "../electron/documents";
import type { ModelConfig, Project, Run, Chapter } from "../src/shared";
const stores: Store[] = [];
const db = () => {
  const d = new Store(":memory:");
  stores.push(d);
  return d;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of stores.splice(0)) s.close();
});
const model: ModelConfig = {
  id: "m",
  name: "测试模型",
  protocol: "openai",
  baseUrl: "http://127.0.0.1:12345/v1",
  model: "test",
  contextLimit: 32000,
  outputLimit: 4000,
  inputPrice: 1,
  outputPrice: 2,
};
const result = (text: string): Generation => ({
  text,
  inputTokens: 100,
  outputTokens: 200,
  estimated: false,
});
function fixture(
  reviewers = 1,
  mode: "short" | "long" = "short",
  targetWords = 8000,
) {
  const store = db();
  store.put("model", model);
  store.put("model", { ...model, id: "n", name: "另一模型" });
  const p = store.createProject({
    mode,
    title: "测试小说",
    idea: "寻找失踪的灯塔守护者",
    targetWords,
    batchSize: 5,
    roles: {
      planner: "m",
      writer: "m",
      reviewers: reviewers === 1 ? ["m"] : ["m", "n"],
      plannerPrompt: "",
      writerPrompt: "",
      reviewerPrompts: ["", ""],
    },
  });
  return {
    store,
    p,
    keys: new Map([
      ["m", "test-key"],
      ["n", "test-key"],
    ]),
  };
}
function transportFor(
  mode: "short" | "long" = "short",
  length = 8000,
  serious = false,
) {
  return vi.fn(
    async (
      _config: any,
      _key: any,
      messages: any[],
      signal: AbortSignal,
      delta?: (x: string) => void,
    ) => {
      signal.throwIfAborted();
      const sys = messages[0].content;
      const prompt = messages[1].content;
      let text = "";
      if (sys.includes('"outline"'))
        text = JSON.stringify({
          outline: "寻找灯塔，最后归来。",
          facts: [
            {
              kind: "人物",
              name: "林舟",
              detail: "主角林舟是一名记者",
              aliases: [],
              planned: false,
            },
          ],
          chapters: Array.from(
            { length: mode === "short" ? 1 : 5 },
            (_, i) => ({
              title: `第${i + 1}章 灯塔`,
              volume: mode === "short" ? "" : "第一卷",
              beats: "主角追查线索并回到灯塔",
              scenes:
                mode === "short" ? ["抵达灯塔", "找到真相"] : ["抵达灯塔"],
            }),
          ),
        });
      else if (sys.includes('"issues"'))
        text = JSON.stringify({
          summary: "检查完成",
          issues: serious
            ? [
                {
                  severity: "serious",
                  quote: "灯塔",
                  evidence: "设定证据",
                  problem: "时间线矛盾",
                  suggestion: "修复时间",
                },
              ]
            : [],
        });
      else if (sys.includes('"facts"'))
        text = JSON.stringify({
          summary: "林舟抵达灯塔，寻找线索。",
          facts: [
            {
              kind: "时间线",
              name: "到达灯塔",
              detail: "证据：灯塔",
              aliases: [],
              planned: false,
            },
          ],
        });
      else if (prompt.includes("修订以下"))
        text = prompt.split("待修订正文：")[1] || "灯塔";
      else if (prompt.includes("根据要求改写"))
        text = "他停下脚步，决定先听一听风声。";
      else if (prompt.includes("针对审稿意见")) text = "将修复时间线问题。";
      else {
        text =
          "灯塔" +
          "海风吹过旧码头。"
            .repeat(Math.ceil((mode === "short" ? length / 2 : 3000) / 8))
            .slice(0, (mode === "short" ? length / 2 : 3000) - 2);
        delta?.(text);
      }
      return result(text);
    },
  );
}
async function finish(engine: Engine, run: Run) {
  await engine.active.get(run.id)?.done;
  return engine.store.get<Run>("run", run.id);
}
describe("持久化、版本与全文检索", () => {
  it("拒绝旧版本写入，保留可回退版本并标记派生记忆失效", () => {
    const s = db();
    const p = s.createProject({ title: "测试" });
    let c = s.createChapter(p.id, "第一章");
    c = s.saveChapter(c.id, 1, { text: "林舟来到旧灯塔。", status: "final" });
    s.put("fact", {
      id: "fact",
      projectId: p.id,
      chapterId: c.id,
      sourceVersion: c.version,
      stale: false,
    });
    expect(() => s.saveChapter(c.id, 1, { text: "过时文本" })).toThrow("版本");
    const changed = s.saveChapter(c.id, 2, { text: "林舟离开灯塔。" });
    expect(changed.summaryVersion).toBe(0);
    expect(s.get<any>("fact", "fact").stale).toBe(true);
    expect(s.version<Chapter>(c.id, 2).text).toContain("来到");
    expect(s.search(p.id, "灯塔")).toHaveLength(1);
    expect(s.search(p.id, "离开灯塔")).toHaveLength(1);
  });
  it("备份没有密钥和模型配置，恢复不会覆盖已有作品", () => {
    const { store, p } = fixture();
    store.put("secret", { id: "secret", key: "do-not-export" });
    const backup = store.backup();
    expect(JSON.stringify(backup)).not.toContain("do-not-export");
    expect(backup.records.some((x: any) => x.kind === "model")).toBe(false);
    const other = db();
    other.restore(backup);
    expect(other.get<Project>("project", p.id).roles.planner).toBe("");
    expect(() => other.restore(backup)).toThrow("已存在");
  });
  it("能保存和检索百万字、400章作品", () => {
    const s = db();
    const p = s.createProject({});
    const start = performance.now();
    for (let i = 0; i < 400; i++) {
      const c = s.createChapter(p.id, `第${i + 1}章`);
      s.saveChapter(c.id, 1, {
        text: `第${i}章检索点。` + "潮水退去，故事仍在继续。".repeat(250),
        status: "final",
      });
    }
    expect(s.chapterList(p.id)).toHaveLength(400);
    expect(s.search(p.id, "第399章检索点")).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(30000);
  }, 35000);
});
describe("写作与审稿闭环", () => {
  it.each([1, 2])(
    "%i 个审稿角色完成短篇，不强制第三角色",
    async (reviewers) => {
      const { store, p, keys } = fixture(reviewers);
      const mock = transportFor();
      const engine = new Engine(store, keys, () => {}, mock);
      const r = engine.newRun(p.id);
      engine.launch(r);
      const done = await finish(engine, r);
      expect(done.status, done.error).toBe("completed");
      expect(store.chapterList(p.id)).toHaveLength(1);
      const c = store.get<Chapter>("chapter", store.chapterList(p.id)[0].id);
      expect(c.status).toBe("final");
      expect(c.text.length).toBeGreaterThanOrEqual(8000);
      expect(c.summaryVersion).toBe(c.version);
      const reviews = store
        .list<any>("discussion", p.id)
        .filter((d) => d.role.startsWith("审稿"));
      expect(reviews).toHaveLength(reviewers);
      expect(reviews.some((d) => d.role.includes("审稿 3"))).toBe(false);
    },
  );
  it("长篇批次生成五章并逐章维护记忆", async () => {
    const { store, p, keys } = fixture(2, "long");
    const e = new Engine(store, keys, () => {}, transportFor("long"));
    const r = e.newRun(p.id);
    e.launch(r);
    const done = await finish(e, r);
    expect(done.status, done.error).toBe("completed");
    expect(store.chapterList(p.id)).toHaveLength(5);
    expect(
      store
        .chapterList(p.id)
        .every((c) => c.summaryVersion === c.version && c.status === "final"),
    ).toBe(true);
  });
  it.each([3000, 20000])("短篇 %i 字按场景生成并进行分段复核", async (n) => {
    const { store, p, keys } = fixture(1, "short", n);
    const e = new Engine(store, keys, () => {}, transportFor("short", n));
    const r = e.newRun(p.id);
    e.launch(r);
    const done = await finish(e, r);
    expect(done.status, done.error).toBe("completed");
    expect(
      store.get<Chapter>("chapter", store.chapterList(p.id)[0].id).text.length,
    ).toBeGreaterThanOrEqual(n);
    if (n === 20000)
      expect(
        store
          .list<any>("discussion", p.id)
          .some((d) => d.role.startsWith("全篇复核")),
      ).toBe(true);
  });
  it("两轮后严重问题暂停，正文仍是草稿", async () => {
    const { store, p, keys } = fixture();
    const e = new Engine(
      store,
      keys,
      () => {},
      transportFor("short", 8000, true),
    );
    const r = e.newRun(p.id);
    e.launch(r);
    const done = await finish(e, r);
    expect(done.status).toBe("waiting");
    expect(done.error).toContain("两轮");
    expect(store.chapterList(p.id)[0].status).toBe("draft");
    expect(
      store
        .list<any>("discussion", p.id)
        .filter((d) => d.role.startsWith("主笔回应")),
    ).toHaveLength(2);
  });
  it("请求上限暂停，增加上限后跳过已完成步骤", async () => {
    const { store, p, keys } = fixture();
    const mock = transportFor();
    const e = new Engine(store, keys, () => {}, mock);
    const r = e.newRun(p.id, { maxRequests: 2 });
    e.launch(r);
    const first = await finish(e, r);
    expect(first.status).toBe("waiting");
    e.update(r.id, { maxRequests: 100 });
    e.launch(store.get("run", r.id));
    const done = await finish(e, r);
    expect(done.status, done.error).toBe("completed");
    expect(
      store
        .list<any>("discussion", p.id)
        .filter((d) => d.role.includes("故事与场景大纲")),
    ).toHaveLength(1);
    expect(store.chapterList(p.id)).toHaveLength(1);
  });
  it("结构化输出只补正一次且不污染正式章节", async () => {
    const { store, p, keys } = fixture();
    const mock = vi.fn(async () => result("不是JSON"));
    const e = new Engine(store, keys, () => {}, mock);
    const r = e.newRun(p.id);
    e.launch(r);
    const done = await finish(e, r);
    expect(done.status).toBe("waiting");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(store.chapterList(p.id)).toHaveLength(0);
  });
  it("并行调用计入预算，未知价格禁止费用上限模式", async () => {
    const { store, p, keys } = fixture();
    store.put("model", {
      ...model,
      inputPrice: undefined,
      outputPrice: undefined,
    });
    const mock = transportFor();
    const e = new Engine(store, keys, () => {}, mock);
    const r = e.newRun(p.id, { budget: 1 });
    e.launch(r);
    const done = await finish(e, r);
    expect(done.error).toContain("价格");
    expect(mock).not.toHaveBeenCalled();
  });
  it("取消后迟到输出不会写入章节或讨论", async () => {
    const { store, p, keys } = fixture();
    let release!: () => void;
    const waiting = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const mock = vi.fn(async () => {
      entered();
      await waiting;
      return result(
        '{"outline":"x","facts":[],"chapters":[{"title":"x","beats":"x","scenes":["x"]}]}',
      );
    });
    const e = new Engine(store, keys, () => {}, mock);
    const r = e.newRun(p.id);
    e.launch(r);
    await ready;
    const stop = e.stop(p.id, "cancelled");
    release();
    await stop;
    expect(store.chapterList(p.id)).toHaveLength(0);
    expect(store.list("discussion", p.id)).toHaveLength(0);
    expect(store.get<Run>("run", r.id).status).toBe("cancelled");
  });
  it("选区修改建议遇到新版正文拒绝采纳", async () => {
    const { store, p, keys } = fixture();
    let c = store.createChapter(p.id, "第一章");
    c = store.saveChapter(c.id, 1, { text: "他来到灯塔，看见了新的线索。" });
    const service = new Service(store, keys, () => {}, transportFor());
    const run = await service.call("rewrite.request", {
      chapterId: c.id,
      baseVersion: c.version,
      start: 0,
      end: 5,
      instruction: "增加紧张感",
    });
    await finish(service.engine, run);
    const suggestion = store.list<any>("proposal", p.id)[0];
    store.saveChapter(c.id, c.version, { text: "用户已经修改的正文" });
    await expect(
      service.call("rewrite.accept", { id: suggestion.id }),
    ).rejects.toThrow("过期");
    expect(store.get<Chapter>("chapter", c.id).text).toBe("用户已经修改的正文");
  });
});
describe("任务恢复与参考学习", () => {
  it("已确认的后文修复在写入后中断，恢复不重复改写", async () => {
    const { store, p, keys } = fixture(1, "long");
    let source = store.createChapter(p.id, "前文");
    source = store.saveChapter(source.id, 1, {
      text: "灯塔已经熄灭。",
      status: "final",
    });
    let target = store.createChapter(p.id, "后文");
    target = store.saveChapter(target.id, 1, {
      text: "他看见远处的灯塔仍然亮着。",
      status: "final",
    });
    store.put("impact", {
      id: "impact-test",
      projectId: p.id,
      sourceId: source.id,
      sourceVersion: source.version,
      chapterIds: [target.id],
      reason: "前文灯塔熄灭",
      status: "pending",
    });
    const fallback = transportFor("long");
    const mock = vi.fn(async (...args: Parameters<typeof generate>) =>
      args[2][1].content.includes("用户已确认检查")
        ? result("他望向已经熄灭的灯塔。")
        : fallback(...(args as Parameters<typeof fallback>)),
    );
    const service = new Service(store, keys, () => {}, mock);
    const r = service.engine.newRun(p.id, {
      kind: "impact",
      maxRequests: 1,
      data: {
        impactId: "impact-test",
        sourceVersion: source.version,
        targets: [target.id],
        completed: [],
        states: {},
      },
    });
    service.engine.launch(r, (s) => service.impactTask(r.id, s));
    expect((await finish(service.engine, r)).status).toBe("waiting");
    expect(store.get<Chapter>("chapter", target.id).text).toContain("已经熄灭");
    await service.call("run.resume", { id: r.id, maxRequests: 100 });
    expect((await finish(service.engine, r)).status).toBe("completed");
    expect(
      mock.mock.calls.filter((x) => x[2][1].content.includes("用户已确认检查")),
    ).toHaveLength(1);
    expect(store.get<any>("impact", "impact-test").status).toBe("resolved");
    expect(store.get<Chapter>("chapter", target.id).status).toBe("final");
  });
  it("临时网络错误最多重试两次，所有尝试计入请求数", async () => {
    const { store, p, keys } = fixture();
    const transport = vi.fn(async () => {
      throw new ApiError("模拟限流", true);
    });
    const engine = new Engine(store, keys, () => {}, transport);
    const run = engine.newRun(p.id);
    engine.launch(run);
    const done = await finish(engine, run);
    expect(done.status).toBe("waiting");
    expect(done.requests).toBe(3);
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it("搜索适配器最多三次查询，去重并传入时间筛选", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("freshness")).toBe("pm");
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: "资料",
                  url: "https://example.com/novel#one",
                  description: "相关作品",
                },
              ],
            },
          }),
        );
      });
    const found = await searchReferences("fake-key", "悬疑短篇", {
      freshness: "pm",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(found).toHaveLength(1);
    expect(found[0].reason).toContain("尚未核实");
  });
  it("自动搜索正文不可读时持久化候选和失败原因，暂停等待补充", async () => {
    const { store, keys } = fixture();
    keys.set("brave", "fake-key");
    vi.spyOn(referenceNetwork, "searchReferences").mockResolvedValue([
      {
        title: "候选",
        url: "https://example.com/novel",
        description: "节选",
        reason: "相关参考",
      },
    ]);
    vi.spyOn(referenceNetwork, "fetchPublic").mockRejectedValue(
      new Error("页面需要登录"),
    );
    const service = new Service(store, keys, () => {}, transportFor());
    const { run } = await service.call("reference.auto", {
      query: "悬疑短篇",
      modelId: "m",
    });
    const done = await finish(service.engine, run);
    expect(done.status).toBe("waiting");
    expect(done.data.candidates).toHaveLength(1);
    expect(done.data.failures[0].error).toContain("需要登录");
    expect(store.list("template")).toHaveLength(0);
  });
  it("参考学习按资料持久化进度，恢复不重复分析已完成资料或创建模板", async () => {
    const { store, keys } = fixture();
    const mock = vi.fn(async () =>
      result(
        JSON.stringify({
          analysis: "片段1：以失踪建立核心冲突。证据：灯塔。",
          methods: "开头设问；逐步释放线索；结尾回应悬念。",
        }),
      ),
    );
    const service = new Service(store, keys, () => {}, mock);
    const refs: any[] = [];
    for (const title of ["参考甲", "参考乙"])
      refs.push(
        await service.call("reference.save", {
          title,
          text: "灯塔的秘密。".repeat(100),
          scope: "excerpt",
        }),
      );
    const r = service.engine.newRun("", {
      kind: "learn",
      maxRequests: 1,
      data: { referenceIds: refs.map((x) => x.id), modelId: "m" },
    });
    service.engine.launch(r, (signal) =>
      service.learn(r.id, refs, "m", signal),
    );
    expect((await finish(service.engine, r)).status).toBe("waiting");
    expect(store.get<any>("reference", refs[0].id).version).toBe(2);
    expect(store.version<any>(refs[0].id, 2).analyzed).toContain("证据");
    await service.call("run.resume", { id: r.id, maxRequests: 100 });
    expect((await finish(service.engine, r)).status).toBe("completed");
    expect(mock).toHaveBeenCalledTimes(2);
    expect(store.get<any>("reference", refs[0].id).version).toBe(2);
    expect(store.list("template")).toHaveLength(1);
    expect((await service.call("snapshot")).referenceRuns[0].id).toBe(r.id);
  });
  it("停止应用时也暂停无作品归属的参考任务", async () => {
    const { store, keys } = fixture();
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const engine = new Engine(
      store,
      keys,
      () => {},
      async (_c, _k, _m, signal) => {
        entered();
        await new Promise<void>((_r, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort")), {
            once: true,
          }),
        );
        return result("unreachable");
      },
    );
    const run = engine.newRun("", { kind: "learn" });
    engine.launch(run, (s) => engine.ask(run.id, "m", "学习", "正文", s));
    await ready;
    await engine.stopAll();
    expect(store.get<Run>("run", run.id).status).toBe("paused");
    expect(engine.active.size).toBe(0);
  });
  it("短篇有内容时拒绝创建第二个故事，保留已有正文", async () => {
    const { store, p, keys } = fixture();
    const service = new Service(store, keys, () => {}, transportFor());
    const c = store.createChapter(p.id, "完整故事");
    store.saveChapter(c.id, c.version, { text: "已有正文" });
    await expect(
      service.call("run.start", { projectId: p.id }),
    ).rejects.toThrow("已有正文");
    expect(store.chapterList(p.id)).toHaveLength(1);
  });
  it("选区改写中断后从任务历史恢复，建议只保存一次", async () => {
    const { store, p, keys } = fixture();
    let c = store.createChapter(p.id, "正文");
    c = store.saveChapter(c.id, 1, { text: "灯塔亮了，他向前走。" });
    const service = new Service(store, keys, () => {}, transportFor());
    const r = service.engine.newRun(p.id, {
      kind: "rewrite",
      maxRequests: 1,
      data: {
        request: {
          chapterId: c.id,
          baseVersion: c.version,
          start: 0,
          end: 4,
          instruction: "描写灯塔",
        },
      },
    });
    service.engine.update(r.id, { status: "paused" });
    await service.call("run.resume", { id: r.id });
    expect((await finish(service.engine, r)).status).toBe("completed");
    expect(store.list("proposal", p.id)).toHaveLength(1);
  });
  it("锁定设定在正文修改后仍是约束，卷摘要失效后重建", async () => {
    const { store, p, keys } = fixture(1, "long");
    const engine = new Engine(store, keys, () => {}, transportFor("long"));
    const run = engine.newRun(p.id);
    engine.launch(run);
    expect((await finish(engine, run)).status).toBe("completed");
    const c = store.get<Chapter>("chapter", store.chapterList(p.id)[0].id);
    store.put("fact", {
      id: "locked",
      projectId: p.id,
      chapterId: c.id,
      kind: "规则",
      name: "誓约",
      aliases: [],
      detail: "永不说谎",
      locked: true,
      stale: false,
      planned: false,
      sourceVersion: c.version,
    });
    store.saveChapter(c.id, c.version, { text: c.text + "\n灯光熄灭。" });
    expect(store.list<any>("volumeMemory", p.id)[0].stale).toBe(true);
    expect(engine.context(p, "誓约")).toContain("永不说谎");
    const service = new Service(store, keys, () => {}, transportFor("long"));
    const rebuild = await service.call("memory.rebuild", { projectId: p.id });
    expect((await finish(service.engine, rebuild)).status).toBe("completed");
    expect(store.list<any>("volumeMemory", p.id)[0].stale).toBe(false);
  });
});

describe("协议、网络边界与文档", () => {
  it("SSE 跨分块和中文字符能正确恢复", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"text":"灯塔"}\r\n\r\ndata: [DONE]\r\n\r\n',
    );
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3)
          c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const events = [];
    for await (const event of sse(stream)) events.push(event);
    expect(events).toEqual([{ text: "灯塔" }]);
  });
  it.each(["openai", "gemini", "anthropic"] as const)(
    "%s 适配器提取正文和用量",
    async (protocol) => {
      const events =
        protocol === "openai"
          ? [
              {
                choices: [
                  { delta: { content: "灯塔" }, finish_reason: "stop" },
                ],
              },
              { usage: { prompt_tokens: 10, completion_tokens: 5 } },
            ]
          : protocol === "gemini"
            ? [
                {
                  candidates: [
                    {
                      content: { parts: [{ text: "灯塔" }] },
                      finishReason: "STOP",
                    },
                  ],
                  usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                  },
                },
              ]
            : [
                {
                  type: "message_start",
                  message: { usage: { input_tokens: 10 } },
                },
                {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: "灯塔" },
                },
                {
                  type: "message_delta",
                  usage: { output_tokens: 5 },
                  delta: { stop_reason: "end_turn" },
                },
              ];
      let called: any;
      const fake = vi.fn(async (url, opts) => {
        called = { url, opts };
        return new Response(
          events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
        );
      });
      const r = await generate(
        { ...model, protocol },
        "secret",
        [{ role: "user", content: "写作" }],
        new AbortController().signal,
        () => {},
        fake as any,
      );
      expect(r.text).toBe("灯塔");
      expect(r.inputTokens).toBe(10);
      expect(r.outputTokens).toBe(5);
      expect(called.opts.redirect).toBe("error");
      expect(called.url).not.toContain("secret");
    },
  );
  it("鉴权错误不重试，限流错误可重试", async () => {
    for (const status of [401, 429]) {
      try {
        await generate(
          model,
          "key",
          [],
          new AbortController().signal,
          () => {},
          vi.fn(async () => new Response("", { status })) as any,
        );
        throw Error("expected");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).retryable).toBe(status === 429);
      }
    }
  });
  it("余额不足不按普通429重试，流式缺少结束标志不能视作完成", async () => {
    const signal = new AbortController().signal;
    try {
      await generate(
        model,
        "key",
        [],
        signal,
        () => {},
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ error: { code: "insufficient_quota" } }),
              { status: 429 },
            ),
        ) as any,
      );
      throw new Error("expected");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).retryable).toBe(false);
      expect((e as Error).message).toContain("余额");
    }
    await expect(
      generate(
        model,
        "key",
        [],
        signal,
        () => {},
        vi.fn(
          async () =>
            new Response(
              'data: {"choices":[{"delta":{"content":"部分正文"}}]}\n\n',
            ),
        ) as any,
      ),
    ).rejects.toThrow("提前结束");
  });
  it("拒绝本机、内网、IPv6 mapped 和非 HTTP 参考地址", async () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "0.0.0.0",
    ])
      expect(isPublicIP(ip), ip).toBe(false);
    expect(isPublicIP("8.8.8.8")).toBe(true);
    for (const url of [
      "http://127.0.0.1",
      "http://localhost",
      "http://[::1]",
      "file:///c:/secret",
      "https://user:pass@example.com",
    ])
      await expect(resolvePublic(url)).rejects.toThrow();
  });
  it("不把网页节选冒充全文或热度证明", () => {
    const article = extractArticle(
      "<html><title>灯塔</title><body><article><h1>灯塔</h1><p>" +
        "海风吹过旧码头。".repeat(100) +
        "</p></article></body></html>",
      "https://example.com",
    );
    expect(article.scope).toBe("excerpt");
    expect(article.evidence).toContain("尚未核实");
  });
  it("导入中文分章并导出能再次打开的 Word", async () => {
    const parts = splitChapters(
      "第一章 开端\n\n林舟来到灯塔。\n\n第二章 真相\n\n线索藏在墙后。",
    );
    expect(parts).toHaveLength(2);
    const bytes = await exportDocx("灯塔", "简介", parts);
    const imported = await importBuffer(bytes, ".docx");
    expect(imported.map((x) => x.text).join("")).toContain("林舟来到灯塔");
    expect(imported.map((x) => x.text).join("")).toContain("线索藏在墙后");
    expect(printHTML("<script>", parts)).not.toContain("<h1><script>");
  });
  it("按场景长度切分，不丢失正文", () => {
    const text = "甲".repeat(25000);
    expect(splitText(text, 6000).join("")).toBe(text);
    expect(splitText(text, 6000).every((x) => x.length <= 6000)).toBe(true);
  });
});

describe("写作 Skills", () => {
  it("导入、版本冲突、备份恢复与删除绑定", async () => {
    const { store, p, keys } = fixture();
    const svc = new Service(store, keys, () => {});
    const s = await svc.call("skill.save", {
      name: "节奏",
      content: "开场使用行动。",
    });
    await svc.call("project.update", {
      id: p.id,
      revision: 1,
      patch: { skillBindings: { writer: [s.id] } },
    });
    const v2 = await svc.call("skill.save", {
      id: s.id,
      baseVersion: 1,
      name: s.name,
      content: "开场使用冲突。",
    });
    expect(v2.version).toBe(2);
    expect(v2.hash).not.toBe(s.hash);
    expect(store.version(s.id, 1).content).toBe(s.content);
    await expect(
      svc.call("skill.save", {
        id: s.id,
        baseVersion: 1,
        name: s.name,
        content: "旧修改",
      }),
    ).rejects.toThrow("版本");
    const copy = db();
    copy.restore(store.backup());
    expect(copy.get("skill", s.id).content).toBe(v2.content);
    expect(copy.get("project", p.id).skillBindings.writer).toEqual([s.id]);
    await svc.call("skill.delete", { id: s.id });
    expect(store.get("project", p.id).skillBindings.writer).toEqual([]);
    await expect(
      svc.call("skill.save", { name: "", content: "" }),
    ).rejects.toThrow();
    await expect(
      svc.call("skill.save", { name: "大文件", content: "文".repeat(24001) }),
    ).rejects.toThrow();
  });
  it("同模型角色隔离，真实写作流程携带 Skills 且保留调用记录", async () => {
    const { store, p, keys } = fixture(2);
    const mock = transportFor();
    const svc = new Service(store, keys, () => {}, mock);
    const bindings: any = {};
    for (const role of ["planner", "writer", "reviewer"]) {
      const s = await svc.call("skill.save", {
        name: role,
        content: `SKILL_MARKER_${role}`,
      });
      bindings[role] = [s.id];
    }
    store.put("project", { ...p, skillBindings: bindings });
    const r = svc.engine.newRun(p.id);
    svc.engine.launch(r);
    expect((await finish(svc.engine, r)).status).toBe("completed");
    const systems = mock.mock.calls.map((c: any) => c[2][0].content as string);
    for (const role of ["planner", "writer", "reviewer"])
      expect(systems.some((s) => s.includes(`SKILL_MARKER_${role}`))).toBe(
        true,
      );
    for (const system of systems)
      expect(
        ["planner", "writer", "reviewer"].filter((r) =>
          system.includes(`SKILL_MARKER_${r}`),
        ).length,
      ).toBeLessThanOrEqual(1);
    expect(
      store
        .list<any>("discussion")
        .some((d) => d.role.includes("Skills: writer v1")),
    ).toBe(true);
    expect(
      store
        .list<any>("fact")
        .some((f) => JSON.stringify(f).includes("SKILL_MARKER")),
    ).toBe(false);
  });
  it("运行中禁止修改，超上下文拒绝请求，不静默丢弃 Skill", async () => {
    const { store, p, keys } = fixture();
    const mock = vi.fn(async () => result("正文"));
    const svc = new Service(store, keys, () => {}, mock);
    const s = await svc.call("skill.save", {
      name: "大规则",
      content: "规则".repeat(11000),
    });
    store.put("project", { ...p, skillBindings: { writer: [s.id] } });
    const r = svc.engine.newRun(p.id);
    store.put("run", { ...r, status: "running" });
    await expect(svc.call("skill.delete", { id: s.id })).rejects.toThrow(
      "暂停",
    );
    await expect(
      svc.engine.ask(r.id, "m", "测试", "正文", new AbortController().signal, {
        skillRole: "writer",
      }),
    ).rejects.toThrow("上下文");
    expect(mock).not.toHaveBeenCalled();
  });
});

it("写作复盘产生待审 Skill，采纳升级、保留原版并防止重复采纳", async()=>{
 const {store,p,keys}=fixture();
 const c=store.createChapter(p.id,"试写"); store.saveChapter(c.id,c.version,{text:"主角发现门锁被更换，决定调查。"});
 const mock=vi.fn(async()=>result(JSON.stringify({name:"悬念写作",content:"先给出反常细节，再展示人物决定。",reason:"从开头节选提炼，尚未验证全篇效果。",evidenceIds:[c.id]})));
 const svc=new Service(store,keys,()=>{},mock);
 const old=await svc.call("skill.save",{name:"悬念写作",content:"展示人物决定。"});
 const run=await svc.call("skill.evolve",{projectId:p.id,skillId:old.id});
 expect((await finish(svc.engine,run)).status).toBe("completed");
 expect(store.get("skill",old.id).version).toBe(1);
 const suggestion=store.list<any>("skillSuggestion")[0]; expect(suggestion.status).toBe("pending");
 expect(suggestion.evidence.chapters[0].version).toBe(2);
 const updated=await svc.call("skill.accept",{id:suggestion.id}); expect(updated.version).toBe(2);
 expect(store.version(old.id,1).content).toBe(old.content);
 await expect(svc.call("skill.accept",{id:suggestion.id})).rejects.toThrow("已处理");
 const second=await svc.call("skill.evolve",{projectId:p.id,skillId:old.id}); await finish(svc.engine,second);
 const pending=store.list<any>("skillSuggestion").find(s=>s.status==="pending");
 await svc.call("skill.save",{id:old.id,baseVersion:2,name:old.name,content:"用户的新规则"});
 await expect(svc.call("skill.accept",{id:pending.id})).rejects.toThrow("版本");
 await svc.call("skill.reject",{id:pending.id}); expect(store.get("skill",old.id).content).toBe("用户的新规则");
});
it("复盘拒绝空作品及伪造证据，不创建可采纳建议",async()=>{
 const {store,p,keys}=fixture();
 const svc=new Service(store,keys,()=>{},async()=>result(JSON.stringify({name:"规则",content:"写冲突",reason:"测试",evidenceIds:["invented"]})));
 await expect(svc.call("skill.evolve",{projectId:p.id})).rejects.toThrow("先完成");
 const c=store.createChapter(p.id,"开头"); store.saveChapter(c.id,c.version,{text:"门外响起敲门声。"});
 const r=await svc.call("skill.evolve",{projectId:p.id}); expect((await finish(svc.engine,r)).status).toBe("waiting");
 expect(store.list("skillSuggestion")).toHaveLength(0);
});
