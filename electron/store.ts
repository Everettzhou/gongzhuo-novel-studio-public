import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { Chapter, Project, Fact } from "../src/shared";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const defaults = {
  planner: "",
  writer: "",
  reviewers: [""],
  plannerPrompt: "",
  writerPrompt: "",
  reviewerPrompts: ["", ""],
};
export class Store {
  db: DatabaseSync;
  private transactionDepth = 0;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT '',data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_project ON records(kind,project_id);
      CREATE TABLE IF NOT EXISTS versions(entity_id TEXT,version INTEGER,data TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(entity_id,version));
      CREATE VIRTUAL TABLE IF NOT EXISTS chapter_search USING fts5(id UNINDEXED,project_id UNINDEXED,title,text,tokenize='trigram');
      PRAGMA user_version=1;`);
    for (const run of this.list<any>("run"))
      if (run.status === "running")
        this.put("run", {
          ...run,
          status: "paused",
          stage: "应用重新启动，可恢复任务",
          updatedAt: now(),
        });
  }
  get<T = any>(kind: string, entityId: string): T {
    const row = this.db
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, entityId) as any;
    if (!row) throw new Error("记录不存在或已删除");
    return JSON.parse(row.data);
  }
  maybe<T = any>(kind: string, entityId: string): T | null {
    try {
      return this.get(kind, entityId);
    } catch {
      return null;
    }
  }
  list<T = any>(kind: string, projectId?: string): T[] {
    const rows =
      projectId === undefined
        ? this.db
            .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
            .all(kind)
        : this.db
            .prepare(
              "SELECT data FROM records WHERE kind=? AND project_id=? ORDER BY rowid",
            )
            .all(kind, projectId);
    return rows.map((r: any) => JSON.parse(r.data));
  }
  put<T extends { id: string; projectId?: string }>(kind: string, value: T): T {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,project_id,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,project_id=excluded.project_id",
      )
      .run(kind, value.id, value.projectId || "", JSON.stringify(value));
    return value;
  }
  remove(kind: string, entityId: string) {
    this.db
      .prepare("DELETE FROM records WHERE kind=? AND id=?")
      .run(kind, entityId);
  }
  transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.transactionDepth--;
    }
  }
  archive(value: { id: string; version: number }) {
    this.db
      .prepare("INSERT OR IGNORE INTO versions VALUES(?,?,?,?)")
      .run(value.id, value.version, JSON.stringify(value), now());
  }
  versions(entityId: string) {
    return this.db
      .prepare(
        "SELECT version,created_at, json_extract(data,'$.status') status FROM versions WHERE entity_id=? ORDER BY version DESC",
      )
      .all(entityId);
  }
  version<T = any>(entityId: string, version: number): T {
    const row = this.db
      .prepare("SELECT data FROM versions WHERE entity_id=? AND version=?")
      .get(entityId, version) as any;
    if (!row) throw new Error("版本不存在");
    return JSON.parse(row.data);
  }
  createProject(input: Partial<Project>): Project {
    const p: Project = {
      id: id(),
      title: "未命名作品",
      mode: "long",
      idea: "",
      genre: "",
      audience: "",
      style: "",
      forbidden: "",
      targetWords: 1000000,
      chapterWords: 3000,
      batchSize: 5,
      roles: structuredClone(defaults),
      outline: "",
      revision: 1,
      templateIds: [],
      influence: { structure: 70, rhythm: 70, language: 30 },
      createdAt: now(),
      updatedAt: now(),
      ...input,
    };
    return this.put("project", p);
  }
  chapterList(projectId: string): Omit<Chapter, "text" | "doc">[] {
    return this.db
      .prepare(
        "SELECT json_remove(data,'$.text','$.doc') data FROM records WHERE kind='chapter' AND project_id=? ORDER BY CAST(json_extract(data,'$.ordinal') AS INTEGER)",
      )
      .all(projectId)
      .map((r: any) => JSON.parse(r.data));
  }
  createChapter(projectId: string, title: string, volume = ""): Chapter {
    this.get("project", projectId);
    return this.transaction(() => {
      const c: Chapter = {
        id: id(),
        projectId,
        ordinal: this.chapterList(projectId).length + 1,
        title,
        volume,
        text: "",
        doc: null,
        version: 1,
        status: "draft",
        summary: "",
        summaryVersion: 0,
        updatedAt: now(),
      };
      this.put("chapter", c);
      this.archive(c);
      this.index(c);
      return c;
    });
  }
  index(c: Chapter) {
    this.db.prepare("DELETE FROM chapter_search WHERE id=?").run(c.id);
    this.db
      .prepare(
        "INSERT INTO chapter_search(id,project_id,title,text) VALUES(?,?,?,?)",
      )
      .run(c.id, c.projectId, c.title, c.text);
  }
  saveChapter(
    entityId: string,
    baseVersion: number,
    update: Partial<Chapter>,
  ): Chapter {
    return this.transaction(() => {
      const old = this.get<Chapter>("chapter", entityId);
      if (old.version !== baseVersion)
        throw new Error("正文版本已变化，请重新读取后再修改");
      const c = {
        ...old,
        ...update,
        id: old.id,
        projectId: old.projectId,
        version: old.version + 1,
        updatedAt: now(),
      };
      if (c.text !== old.text) {
        c.summaryVersion = 0;
        for (const f of this.list<Fact>("fact", c.projectId))
          if (f.chapterId === c.id) this.put("fact", { ...f, stale: true });
        for (const v of this.list<any>("volumeMemory", c.projectId))
          if (v.sources.some((s: any) => s.id === c.id))
            this.put("volumeMemory", { ...v, stale: true });
      }
      this.put("chapter", c);
      this.archive(c);
      this.index(c);
      return c;
    });
  }
  search(
    projectId: string,
    query: string,
    limit = 12,
  ): { id: string; title: string; excerpt: string }[] {
    const q = query.trim().slice(0, 120);
    if (!q) return [];
    if ([...q].length < 3)
      return this.db
        .prepare(
          "SELECT id,json_extract(data,'$.title') title,substr(json_extract(data,'$.text'),max(1,instr(json_extract(data,'$.text'),?)-80),320) excerpt FROM records WHERE kind='chapter' AND project_id=? AND instr(json_extract(data,'$.text'),?)>0 LIMIT ?",
        )
        .all(q, projectId, q, limit) as any;
    return this.db
      .prepare(
        "SELECT id,title,snippet(chapter_search,3,'【','】','…',40) excerpt FROM chapter_search WHERE chapter_search MATCH ? AND project_id=? ORDER BY rank LIMIT ?",
      )
      .all('"' + q.replaceAll('"', '""') + '"', projectId, limit) as any;
  }
  backup() {
    return {
      format: "gongzhuo",
      schema: 1,
      createdAt: now(),
      records: this.db
        .prepare(
          "SELECT kind,data FROM records WHERE kind NOT IN ('model','secret')",
        )
        .all(),
      versions: this.db.prepare("SELECT * FROM versions").all(),
    };
  }
  restore(bundle: any) {
    if (
      bundle?.format !== "gongzhuo" ||
      bundle.schema !== 1 ||
      !Array.isArray(bundle.records) ||
      !Array.isArray(bundle.versions)
    )
      throw new Error("不支持的备份格式");
    const allowed = new Set([
      "project",
      "chapter",
      "fact",
      "run",
      "discussion",
      "reference",
      "template",
      "skill",
      "skillSuggestion",
      "proposal",
      "impact",
      "step",
      "volumeMemory",
    ]);
    const items = bundle.records.map((r: any) => {
      if (!allowed.has(r.kind)) throw new Error("备份包含未知记录");
      const v = JSON.parse(r.data);
      if (typeof v.id !== "string") throw new Error("备份记录损坏");
      return { kind: r.kind, v };
    });
    if (items.some((r: any) => this.maybe(r.kind, r.v.id)))
      throw new Error(
        "备份中的作品已存在。为保护现有数据，本次未覆盖；请在新的数据目录恢复。",
      );
    this.transaction(() => {
      for (const { kind, v } of items) {
        if (kind === "run" && v.status === "running") v.status = "paused";
        if (kind === "project") v.roles = structuredClone(defaults);
        this.put(kind, v);
        if (kind === "chapter") this.index(v);
      }
      for (const v of bundle.versions)
        this.db
          .prepare("INSERT INTO versions VALUES(?,?,?,?)")
          .run(v.entity_id, v.version, v.data, v.created_at);
    });
  }
  close() {
    this.db.close();
  }
}
