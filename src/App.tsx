import React, { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BookOpen,
  Library,
  Settings,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Sparkles,
  Search,
  Play,
  Pause,
  Square,
  Download,
  Upload,
  History,
  Check,
  X,
  ChevronRight,
  FileText,
  PanelRightClose,
  Users,
  Feather,
  Trash2,
  Save,
  LoaderCircle,
  BookMarked,
  ShieldCheck,
  FolderOpen,
} from "lucide-react";
import type {
  Snapshot,
  Project,
  ProjectDetail,
  Chapter,
  ModelConfig,
  Reference,
  Template,
  Run,
  AppEvent,
} from "./shared";
const api = <T = any,>(method: string, args?: any) =>
  window.studio.call<T>(method, args);
const empty: Snapshot = {
  skillSuggestions: [],
  skills: [],
  projects: [],
  models: [],
  references: [],
  templates: [],
  searchConfigured: false,
  referenceRuns: [],
};
const escape = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const html = (s: string) =>
  s
    .split("\n")
    .map((l) => `<p>${escape(l)}</p>`)
    .join("");
const stamp = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const count = (s: string) => [...s.replace(/\s/g, "")].length;
const statusText: Record<string, string> = {
  running: "正在创作",
  paused: "已暂停",
  waiting: "需要处理",
  failed: "失败",
  cancelled: "已取消",
  completed: "已完成",
};
function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
  title,
}: any) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`btn ${primary ? "primary" : ""} ${className}`}
    >
      {children}
    </button>
  );
}
function Field({ label, children, hint }: any) {
  const fieldId = React.useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            id: fieldId,
            "aria-describedby": hint ? fieldId + "-hint" : undefined,
          })
        : children}
      {hint && <small id={fieldId + "-hint"}>{hint}</small>}
    </div>
  );
}
function Modal({ title, children, onClose, wide = false, layer = 100 }: any) {
  return (
    <div
      className="modal-shade"
      style={{ zIndex: layer }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  const [page, setPage] = useState<
    "library" | "studio" | "references" | "settings"
  >("library");
  const [projectId, setProjectId] = useState("");
  const [detail, setDetail] = useState<
    (ProjectDetail & { proposals: any[] }) | null
  >(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [modal, setModal] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(0);
  const [rightTab, setRightTab] = useState("discussion");
  const [stream, setStream] = useState<AppEvent | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState<any>(null);
  const [rewrite, setRewrite] = useState("");
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<any[] | null>(null);
  const [maxRequests, setMaxRequests] = useState(100);
  const [budget, setBudget] = useState("");
  const current = useRef<Chapter | null>(null);
  const dirtyRef = useRef(false);
  const editSerial = useRef(0);
  const savePromise = useRef<Promise<any> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const timer = useRef<any>(null);
  const selectedProject = useRef("");
  const detailRef = useRef(detail);
  detailRef.current = detail;
  selectedProject.current = projectId;
  const notify = (message: string) => {
    setToast(message);
  };
  const act = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy((n) => n + 1);
    try {
      return await fn();
    } catch (e) {
      notify(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy((n) => n - 1);
    }
  };
  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    editorProps: {
      attributes: {
        class: "manuscript",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "小说正文",
      },
    },
    onUpdate: () => {
      dirtyRef.current = true;
      editSerial.current++;
      setDirty(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void saveEditor().catch((e) => notify(e.message)),
        1000,
      );
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setSelection(null);
        return;
      }
      const before = editor.state.doc.textBetween(0, from, "\n");
      const selected = editor.state.doc.textBetween(from, to, "\n");
      const full = editor.getText({ blockSeparator: "\n" });
      let start = before.length;
      if (full.slice(start, start + selected.length) !== selected)
        start = full.indexOf(selected, Math.max(0, start - 3));
      setSelection(
        start < 0
          ? null
          : { start, end: start + selected.length, text: selected },
      );
    },
  });
  async function saveEditor() {
    if (savePromise.current) {
      await savePromise.current;
      if (dirtyRef.current) return saveEditor();
      return;
    }
    if (!editor || !current.current || !dirtyRef.current) return;
    const old = current.current;
    const serial = editSerial.current;
    const text = editor.getText({ blockSeparator: "\n" });
    const doc = editor.getJSON();
    setSaving(true);
    const promise = api<Chapter>("chapter.save", {
      id: old.id,
      baseVersion: old.version,
      text,
      doc,
    }).then((c) => {
      if (current.current?.id === c.id) {
        current.current = c;
        setChapter(c);
        if (editSerial.current === serial) {
          dirtyRef.current = false;
          setDirty(false);
        }
      }
    });
    savePromise.current = promise;
    try {
      await promise;
    } finally {
      savePromise.current = null;
      setSaving(false);
    }
    if (dirtyRef.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () => void saveEditor().catch((e) => notify(e.message)),
        800,
      );
    }
  }
  saveRef.current = saveEditor;
  const refresh = useCallback(async () => {
    const s = await api<Snapshot>("snapshot");
    setSnapshot(s);
    if (selectedProject.current) {
      const d = await api<any>("project.detail", {
        id: selectedProject.current,
      });
      setDetail(d);
    }
  }, []);
  useEffect(() => {
    if (!window.studio) {
      notify("请通过桌面应用打开，此页面需要本地创作引擎。");
      return;
    }
    void refresh().catch((e) => notify(e.message));
    let refreshTimer: any;
    const off = window.studio.onEvent((e) => {
      if (e.type === "closing") {
        void saveRef
          .current()
          .then(() => api("app.close"))
          .catch((err) => notify("关闭前保存失败：" + err.message));
        return;
      }
      if (e.type === "delta") {
        if (e.projectId === selectedProject.current) setStream(e);
        return;
      }
      if (e.type === "error") {
        notify(e.text || "后台错误");
        return;
      }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void refresh().catch(() => {}), 200);
    });
    return () => {
      off();
      clearTimeout(refreshTimer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!current.current && detail?.chapters.length) {
      void loadChapter(detail.chapters[0].id);
      return;
    }
    const latest = detail?.chapters.find((x) => x.id === current.current?.id);
    if (
      latest &&
      latest.version !== current.current?.version &&
      !dirtyRef.current &&
      !savePromise.current
    )
      void loadChapter(latest.id);
  }, [detail]);
  async function loadChapter(id: string) {
    await saveEditor();
    const c = await api<Chapter>("chapter.get", { id });
    current.current = c;
    setChapter(c);
    dirtyRef.current = false;
    setDirty(false);
    setSelection(null);
    editor?.commands.setContent(c.doc || html(c.text), { emitUpdate: false });
  }
  async function openProject(p: Project) {
    await saveEditor();
    setProjectId(p.id);
    selectedProject.current = p.id;
    const d = await api<any>("project.detail", { id: p.id });
    setDetail(d);
    setPage("studio");
    setStream(null);
    setHits(null);
    setFilter("");
    if (d.chapters.length) await loadChapter(d.chapters[0].id);
    else {
      current.current = null;
      setChapter(null);
      editor?.commands.setContent("", { emitUpdate: false });
    }
  }
  async function navigate(next: typeof page) {
    await saveEditor();
    setPage(next);
  }
  const activeRun =
    detail?.runs.find((r) => r.status === "running") || detail?.runs[0];
  const p = detail?.project;
  const modelName = (id: string) =>
    snapshot.models.find((m) => m.id === id)?.name || "未选择模型";
  const settingsSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">请选择模型</option>
      {snapshot.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} · {m.model}
        </option>
      ))}
    </select>
  );
  const start = () =>
    act(async () => {
      await saveEditor();
      await api("run.start", {
        projectId,
        maxRequests,
        budget: budget ? Number(budget) : null,
      });
      setRightTab("discussion");
      setStream(null);
      await refresh();
    });
  return (
    <div className="app-shell">
      <aside className="rail">
        <button
          className="brand"
          onClick={() => act(() => navigate("library"))}
        >
          <span className="brand-mark">
            <Feather size={24} />
          </span>
          <span>
            共著<small>GONGZHUO STUDIO</small>
          </span>
        </button>
        <div className="rail-label">创作空间</div>
        <nav>
          <button
            className={page === "library" ? "active" : ""}
            onClick={() => act(() => navigate("library"))}
          >
            <Library size={19} />
            作品书架
          </button>
          <button
            className={page === "references" ? "active" : ""}
            onClick={() => act(() => navigate("references"))}
          >
            <BookMarked size={19} />
            参考与方法
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => act(() => navigate("settings"))}
          >
            <Settings size={19} />
            模型与设置
          </button>
        </nav>
        <div className="rail-divider" />
        <div className="rail-label">
          最近作品{" "}
          <button
            aria-label="新建作品"
            onClick={() => setModal({ type: "new", mode: "long" })}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="recent-list">
          {snapshot.projects
            .slice(-8)
            .reverse()
            .map((x) => (
              <button
                className={
                  page === "studio" && x.id === projectId ? "selected" : ""
                }
                key={x.id}
                onClick={() => act(() => openProject(x))}
              >
                <FileText size={15} />
                <span>{x.title}</span>
              </button>
            ))}
          {!snapshot.projects.length && (
            <p>
              你的下一个故事，
              <br />
              从这里开始。
            </p>
          )}
        </div>
        <div className="rail-bottom">
          <span className="dot" />
          本地工作空间<small>作品留在本机 · 模型按需连接</small>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={14} />
            <span>
              {page === "library"
                ? "作品书架"
                : page === "references"
                  ? "参考与方法"
                  : page === "settings"
                    ? "模型与设置"
                    : p?.title}
            </span>
          </div>
          <span className="local-badge">
            <ShieldCheck size={14} />
            本地优先
          </span>
        </header>
        {page === "library" && (
          <div className="library-page">
            <div className="page-heading">
              <div>
                <div className="eyebrow">让想法，成为故事</div>
                <h1>每一个故事，都值得写完。</h1>
                <p>给 AI 分工，让灵感有章可循。你始终掌握最后一笔。</p>
              </div>
              <Button
                primary
                onClick={() => setModal({ type: "new", mode: "long" })}
              >
                <Plus size={17} />
                新建作品
              </Button>
            </div>
            <div className="entry-grid">
              <button
                className="entry featured"
                onClick={() => setModal({ type: "new", mode: "long" })}
              >
                <div className="entry-icon">
                  <BookOpen size={26} />
                </div>
                <span className="entry-kicker">LONG FORM</span>
                <h2>长篇连载</h2>
                <p>
                  从世界观到每一章，
                  <br />
                  让故事持续生长。
                </p>
                <div className="entry-footer">
                  分卷规划 · 跨章记忆 <ArrowUpRight size={20} />
                </div>
              </button>
              <button
                className="entry"
                onClick={() => setModal({ type: "new", mode: "short" })}
              >
                <div className="entry-icon">
                  <Feather size={26} />
                </div>
                <span className="entry-kicker">SHORT STORY</span>
                <h2>短篇小说</h2>
                <p>
                  一个好点子，一次完整表达。
                  <br />
                  从开篇悬念到最后的回响。
                </p>
                <div className="entry-footer">
                  3,000 — 20,000 字 <ArrowUpRight size={20} />
                </div>
              </button>
              <button className="entry" onClick={() => setPage("references")}>
                <div className="entry-icon">
                  <Sparkles size={26} />
                </div>
                <span className="entry-kicker">LEARN & CREATE</span>
                <h2>参考作品学习</h2>
                <p>
                  拆解好故事的方法，
                  <br />
                  写出属于自己的新故事。
                </p>
                <div className="entry-footer">
                  搜索资料 · 提炼写作模板 <ArrowUpRight size={20} />
                </div>
              </button>
            </div>
            <div className="section-title">
              <h2>
                我的作品 <span>{snapshot.projects.length}</span>
              </h2>
              <span>按最近创建排序</span>
            </div>
            {snapshot.projects.length ? (
              <div className="project-grid">
                {[...snapshot.projects].reverse().map((x, i) => (
                  <button
                    key={x.id}
                    className="project-card"
                    onClick={() => act(() => openProject(x))}
                  >
                    <div className={"book-spine color-" + (i % 4)}>
                      <span>{x.mode === "long" ? "长篇" : "短篇"}</span>
                      <BookOpen size={29} />
                    </div>
                    <div>
                      <small>{x.genre || "未设题材"}</small>
                      <h3>{x.title}</h3>
                      <p>{x.idea || "一个等待展开的故事"}</p>
                      <span>{stamp(x.updatedAt)} 更新</span>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-shelf">
                <BookOpen size={35} />
                <h3>书架还空着，灵感不必等待。</h3>
                <p>选择一种创作方式，或者导入已经写下的故事。</p>
                <button onClick={() => setModal({ type: "new", mode: "long" })}>
                  创建第一部作品 <ArrowUpRight size={15} />
                </button>
              </div>
            )}
            {!snapshot.models.length && (
              <div className="setup-note">
                <span className="setup-number">01</span>
                <div>
                  <strong>先为你的创作团队接入模型</strong>
                  <p>
                    支持 OpenAI 兼容、Gemini 与 Anthropic
                    接口，角色和审稿数量由你决定。
                  </p>
                </div>
                <Button onClick={() => setPage("settings")}>
                  配置模型 <ArrowUpRight size={16} />
                </Button>
              </div>
            )}
          </div>
        )}
        {page === "settings" && (
          <SettingsPage
            snapshot={snapshot}
            refresh={refresh}
            act={act}
            notify={notify}
          />
        )}
        {page === "references" && (
          <ReferencesPage
            snapshot={snapshot}
            refresh={refresh}
            act={act}
            notify={notify}
            settingsSelect={settingsSelect}
          />
        )}
        {page === "studio" && p && (
          <div className="studio">
            <div className="studio-toolbar">
              <div>
                <span className="tag">
                  {p.mode === "long" ? "长篇连载" : "短篇小说"}
                </span>
                <h2>{p.title}</h2>
              </div>
              <div className="toolbar-actions">
                <Button
                  onClick={() =>
                    setModal({ type: "project", value: structuredClone(p) })
                  }
                >
                  <Users size={15} />
                  创作配置
                </Button>
                <Button
                  onClick={() =>
                    act(async () => {
                      await saveEditor();
                      const data = await api("import.preview");
                      if (data) setModal({ type: "import", data });
                    })
                  }
                >
                  <Upload size={15} />
                  导入
                </Button>
                <Button
                  onClick={() =>
                    setModal({ type: "export", format: "docx", range: "all" })
                  }
                >
                  <Download size={15} />
                  导出
                </Button>
                <Button
                  primary
                  onClick={start}
                  disabled={activeRun?.status === "running" || !!busy}
                >
                  <Play size={15} />
                  {p.mode === "long"
                    ? `自动创作 ${p.batchSize} 章`
                    : "创作整篇"}
                </Button>
              </div>
            </div>
            <div className="studio-columns">
              <aside className="chapter-panel">
                <div className="panel-head">
                  <span>作品结构</span>
                  <button
                    className="icon-btn"
                    aria-label="添加章节"
                    onClick={() =>
                      act(async () => {
                        const c = await api("chapter.create", {
                          projectId,
                          title:
                            p.mode === "short"
                              ? "正文"
                              : `第 ${(detail?.chapters.length || 0) + 1} 章`,
                        });
                        await refresh();
                        await loadChapter(c.id);
                      })
                    }
                  >
                    <Plus size={17} />
                  </button>
                </div>
                <div className="search-box">
                  <Search size={14} />
                  <input
                    placeholder="搜索正文…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")
                        act(async () =>
                          setHits(
                            await api("project.search", {
                              id: projectId,
                              query: filter,
                            }),
                          ),
                        );
                    }}
                  />
                  {hits && (
                    <button
                      className="icon-btn"
                      onClick={() => {
                        setHits(null);
                        setFilter("");
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="chapter-list">
                  {hits
                    ? hits.map((hit) => (
                        <button
                          key={hit.id}
                          onClick={() => act(() => loadChapter(hit.id))}
                        >
                          <strong>{hit.title}</strong>
                          <p>{hit.excerpt}</p>
                        </button>
                      ))
                    : detail?.chapters.map((c) => (
                        <button
                          key={c.id}
                          className={chapter?.id === c.id ? "active" : ""}
                          onClick={() => act(() => loadChapter(c.id))}
                        >
                          <div>
                            <span className="chapter-num">
                              {String(c.ordinal).padStart(2, "0")}
                            </span>
                            <strong>{c.title}</strong>
                          </div>
                          <small>
                            {c.volume && c.volume + " · "}
                            {c.status === "final" ? "正式" : "草稿"}{" "}
                            <span>
                              {c.summaryVersion === c.version
                                ? "已记忆"
                                : "待更新记忆"}
                            </span>
                          </small>
                        </button>
                      ))}
                  {!detail?.chapters.length && (
                    <div className="small-empty">
                      章节将在创作时自动生成。
                      <br />
                      也可以手动添加或导入。
                    </div>
                  )}
                </div>
                <div className="chapter-footer">
                  <BookOpen size={14} />
                  {detail?.chapters.length} 个
                  {p.mode === "short" ? "正文片段" : "章节"}
                </div>
              </aside>
              <section className="editor-panel">
                {chapter ? (
                  <>
                    <div className="editor-tools">
                      <div>
                        <button
                          className={editor?.isActive("bold") ? "on" : ""}
                          onClick={() =>
                            editor?.chain().focus().toggleBold().run()
                          }
                          title="加粗"
                        >
                          <b>B</b>
                        </button>
                        <button
                          onClick={() =>
                            editor?.chain().focus().toggleItalic().run()
                          }
                          title="斜体"
                        >
                          <i>I</i>
                        </button>
                        <button
                          onClick={() => editor?.chain().focus().undo().run()}
                          title="撤销"
                        >
                          ↶
                        </button>
                        <button
                          onClick={() => editor?.chain().focus().redo().run()}
                          title="重做"
                        >
                          ↷
                        </button>
                      </div>
                      <div>
                        <span className="save-status">
                          {saving
                            ? "保存中…"
                            : dirty
                              ? "尚未保存"
                              : "已保存到本机"}
                        </span>
                        <button
                          title="版本历史"
                          onClick={() =>
                            act(async () => {
                              await saveEditor();
                              setModal({
                                type: "history",
                                versions: await api("chapter.versions", {
                                  id: chapter.id,
                                }),
                              });
                            })
                          }
                        >
                          <History size={16} />
                        </button>
                        <button title="保存" onClick={() => act(saveEditor)}>
                          <Save size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="paper-scroll">
                      <div className="paper">
                        <div className="paper-meta">
                          {p.mode === "long"
                            ? chapter.volume || "正文"
                            : "SHORT STORY"}{" "}
                          <span>版本 {chapter.version}</span>
                        </div>
                        <input
                          className="chapter-title"
                          aria-label="章节标题"
                          value={chapter.title}
                          onChange={(e) =>
                            setChapter({ ...chapter, title: e.target.value })
                          }
                          onBlur={() => {
                            if (
                              current.current &&
                              chapter.title !== current.current.title
                            )
                              act(async () => {
                                await saveEditor();
                                const c = await api<Chapter>("chapter.save", {
                                  id: chapter.id,
                                  baseVersion: current.current!.version,
                                  text: current.current!.text,
                                  doc: current.current!.doc,
                                  title: chapter.title,
                                });
                                current.current = c;
                                setChapter(c);
                              });
                          }}
                        />
                        <EditorContent editor={editor} />
                        <div className="end-mark">◆</div>
                      </div>
                      {stream?.chapterId === chapter.id &&
                        activeRun?.status === "running" && (
                          <div className="stream-preview">
                            <small>
                              <LoaderCircle className="spin" size={13} />
                              {stream.step} · 生成中
                            </small>
                            <pre>{stream.text}</pre>
                          </div>
                        )}
                    </div>
                    <footer className="editor-footer">
                      <span>
                        {count(
                          editor?.getText() || chapter.text,
                        ).toLocaleString()}{" "}
                        字
                      </span>
                      <span>选中文字，让 AI 帮你修改</span>
                      <button
                        onClick={() =>
                          act(async () => {
                            await saveEditor();
                            const c = await api<Chapter>("chapter.save", {
                              id: chapter.id,
                              baseVersion: current.current!.version,
                              text: current.current!.text,
                              doc: current.current!.doc,
                              status:
                                chapter.status === "final" ? "draft" : "final",
                            });
                            current.current = c;
                            setChapter(c);
                            await refresh();
                          })
                        }
                      >
                        {chapter.status === "final" ? (
                          <>
                            <Check size={13} />
                            正式正文
                          </>
                        ) : (
                          <>草稿 · 标为正式</>
                        )}
                      </button>
                    </footer>
                  </>
                ) : (
                  <div className="editor-empty">
                    <Feather size={42} />
                    <h2>故事从一个念头开始。</h2>
                    <p>
                      {p.idea ||
                        "在创作配置中写下你的想法，再邀请 AI 开始创作。"}
                    </p>
                    <Button primary onClick={start}>
                      <Sparkles size={16} />
                      开始创作
                    </Button>
                    <Button
                      onClick={() =>
                        setModal({ type: "project", value: structuredClone(p) })
                      }
                    >
                      配置创作团队
                    </Button>
                  </div>
                )}
              </section>
              <aside className="discussion-panel">
                <div className="right-tabs">
                  {[
                    ["discussion", "协作记录"],
                    ["memory", "设定记忆"],
                    ["revision", "修改建议"],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      className={rightTab === v ? "active" : ""}
                      onClick={() => setRightTab(v)}
                    >
                      {label}
                      {v === "revision" && !!detail?.proposals?.length && <i />}
                    </button>
                  ))}
                </div>
                <div className="right-content">
                  {rightTab === "discussion" && (
                    <>
                      <details className="task-history">
                        <summary>任务历史 · {detail?.runs.length || 0}</summary>
                        {detail?.runs.map((r) => (
                          <div key={r.id}>
                            <button
                              onClick={() =>
                                act(async () =>
                                  setModal({
                                    type: "run-details",
                                    run: await api("run.get", { id: r.id }),
                                  }),
                                )
                              }
                            >
                              {statusText[r.status]} · {r.stage}
                            </button>
                            {["paused", "waiting", "failed"].includes(
                              r.status,
                            ) && (
                              <Button
                                onClick={() =>
                                  act(async () => {
                                    await saveEditor();
                                    await api("run.resume", {
                                      id: r.id,
                                      maxRequests: Math.max(
                                        maxRequests,
                                        r.requests + 20,
                                      ),
                                      budget: budget ? Number(budget) : null,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                恢复此任务
                              </Button>
                            )}
                          </div>
                        ))}
                      </details>
                      <div className="team-card">
                        <div>
                          <Users size={16} />
                          <strong>本次创作团队</strong>
                        </div>
                        <p>
                          <span>策划</span>
                          {modelName(p.roles.planner)}
                        </p>
                        <p>
                          <span>主笔</span>
                          {modelName(p.roles.writer)}
                        </p>
                        {p.roles.reviewers.map((m, i) => (
                          <p key={i}>
                            <span>审稿 {i + 1}</span>
                            {modelName(m)}
                          </p>
                        ))}
                      </div>
                      {!detail?.discussions.length && (
                        <div className="small-empty">
                          AI 的审稿意见、回应与修订决定
                          <br />
                          会在这里留下记录。
                        </div>
                      )}
                      {[...(detail?.discussions || [])].reverse().map((d) => (
                        <details className="discussion-item" key={d.id}>
                          <summary>
                            <span className="avatar">{d.role.slice(0, 1)}</span>
                            <div>
                              <strong>{d.role}</strong>
                              <small>{d.model}</small>
                            </div>
                            <ChevronRight size={14} />
                          </summary>
                          <pre>{d.content}</pre>
                          <time>{stamp(d.createdAt)}</time>
                        </details>
                      ))}
                    </>
                  )}
                  {rightTab === "memory" && (
                    <>
                      <Button
                        onClick={() =>
                          act(async () => {
                            await saveEditor();
                            await api("memory.rebuild", { projectId });
                            await refresh();
                          })
                        }
                      >
                        <Sparkles size={14} />
                        更新摘要与后文影响
                      </Button>
                      <div className="panel-section">
                        <h3>故事大纲</h3>
                        <pre>
                          {p.outline || "策划完成后，大纲会保存在这里。"}
                        </pre>
                      </div>
                      <Button
                        onClick={() =>
                          setModal({
                            type: "fact",
                            value: {
                              projectId,
                              kind: "人物",
                              name: "",
                              detail: "",
                              aliases: [],
                              planned: false,
                              locked: true,
                            },
                          })
                        }
                      >
                        <Plus size={14} />
                        添加锁定设定
                      </Button>
                      {detail?.facts.map((f) => (
                        <button
                          className={`fact-card ${f.stale ? "stale" : ""}`}
                          key={f.id}
                          onClick={() => setModal({ type: "fact", value: f })}
                        >
                          <small>
                            {f.kind} · {f.planned ? "计划" : "设定 / 已发生"}{" "}
                            {f.locked ? "· 锁定" : ""}{" "}
                            {f.stale ? "· 待更新" : ""}
                          </small>
                          <strong>{f.name}</strong>
                          <p>{f.detail}</p>
                        </button>
                      ))}
                    </>
                  )}
                  {rightTab === "revision" && (
                    <>
                      <div className="rewrite-box">
                        <h3>
                          <Sparkles size={16} />
                          选区修改
                        </h3>
                        {selection ? (
                          <blockquote>
                            {selection.text.slice(0, 250)}
                            {selection.text.length > 250 ? "…" : ""}
                          </blockquote>
                        ) : (
                          <p>先在正文中选择需要修改的文字。</p>
                        )}
                        <textarea
                          placeholder="例如：让对话更自然，保留人物原有立场。"
                          value={rewrite}
                          onChange={(e) => setRewrite(e.target.value)}
                        />
                        <Button
                          primary
                          disabled={!selection || !rewrite || !!busy}
                          onClick={() =>
                            act(async () => {
                              const selected = { ...selection };
                              await saveEditor();
                              await api("rewrite.request", {
                                chapterId: chapter!.id,
                                baseVersion: current.current!.version,
                                start: selected.start,
                                end: selected.end,
                                instruction: rewrite,
                              });
                              notify("正在生成修改建议，原文保持不变");
                            })
                          }
                        >
                          生成修改建议
                        </Button>
                      </div>
                      {detail?.proposals?.map((proposal) => (
                        <div className="proposal-card" key={proposal.id}>
                          <h3>修改对比</h3>
                          <small>原文 · 版本 {proposal.baseVersion}</small>
                          <pre className="diff-old">{proposal.original}</pre>
                          <small>建议</small>
                          <pre className="diff-new">{proposal.replacement}</pre>
                          <div className="button-row">
                            <Button
                              primary
                              onClick={() =>
                                act(async () => {
                                  await saveEditor();
                                  const c = await api<Chapter>(
                                    "rewrite.accept",
                                    { id: proposal.id },
                                  );
                                  await refresh();
                                  await loadChapter(c.id);
                                  notify("已采纳，后文影响已列入待检查");
                                })
                              }
                            >
                              <Check size={14} />
                              采纳
                            </Button>
                            <Button
                              onClick={() =>
                                act(async () => {
                                  await api("rewrite.reject", {
                                    id: proposal.id,
                                  });
                                  await refresh();
                                })
                              }
                            >
                              拒绝
                            </Button>
                          </div>
                        </div>
                      ))}
                      {detail?.impacts.map((impact) => (
                        <div className="impact-card" key={impact.id}>
                          <h3>后文影响检查</h3>
                          <p>{impact.reason}</p>
                          <small>
                            涉及 {impact.chapterIds.length} 个后续章节
                          </small>
                          <div className="button-row">
                            <Button
                              onClick={() =>
                                setModal({ type: "impact", impact })
                              }
                            >
                              查看并决定
                            </Button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </aside>
            </div>
            <div className="runbar">
              <div className="run-state">
                <span
                  className={`dot ${activeRun?.status === "running" ? "pulse" : ""}`}
                />
                <button
                  className="run-detail-button"
                  title="查看任务与中断草稿"
                  onClick={() =>
                    activeRun &&
                    act(async () =>
                      setModal({
                        type: "run-details",
                        run: await api("run.get", { id: activeRun.id }),
                      }),
                    )
                  }
                >
                  {activeRun ? statusText[activeRun.status] : "准备就绪"}
                </button>
                <span>{activeRun?.stage || "配置角色后即可开始"}</span>
                {activeRun?.error && (
                  <button
                    className="error-link"
                    onClick={() => notify(activeRun.error)}
                  >
                    查看原因
                  </button>
                )}
              </div>
              <div className="run-metrics">
                {activeRun && (
                  <>
                    <span>
                      {activeRun.requests}/{activeRun.maxRequests} 次调用
                    </span>
                    <span>
                      {(
                        activeRun.inputTokens + activeRun.outputTokens
                      ).toLocaleString()}{" "}
                      tokens
                    </span>
                    <span>
                      {activeRun.unknownCost
                        ? "费用未知"
                        : `估算 ${activeRun.cost.toFixed(4)}`}
                    </span>
                    {activeRun.status === "running" ? (
                      <Button
                        onClick={() =>
                          act(async () => {
                            await api("run.pause", { id: activeRun.id });
                            await refresh();
                          })
                        }
                      >
                        <Pause size={14} />
                        暂停
                      </Button>
                    ) : (
                      ["paused", "waiting", "failed"].includes(
                        activeRun.status,
                      ) && (
                        <Button
                          onClick={() =>
                            act(async () => {
                              await saveEditor();
                              await api("run.resume", {
                                id: activeRun.id,
                                maxRequests,
                                budget: budget ? Number(budget) : null,
                              });
                              await refresh();
                            })
                          }
                        >
                          <Play size={14} />
                          继续
                        </Button>
                      )
                    )}
                    {!["completed", "cancelled"].includes(activeRun.status) && (
                      <button
                        className="icon-btn"
                        title="取消任务"
                        onClick={() =>
                          act(async () => {
                            await api("run.cancel", { id: activeRun.id });
                            await refresh();
                          })
                        }
                      >
                        <Square size={13} />
                      </button>
                    )}
                  </>
                )}
                <button
                  className="icon-btn"
                  title="任务上限"
                  onClick={() => setModal({ type: "limits" })}
                >
                  <Settings size={15} />
                </button>
              </div>
            </div>
            {activeRun?.error && activeRun.status === "waiting" && (
              <div className="run-error">{activeRun.error}</div>
            )}
          </div>
        )}
      </main>
      {busy > 0 && (
        <div className="busy-indicator">
          <LoaderCircle size={15} className="spin" />
          处理中
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <span>{toast}</span>
          <button onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal?.type === "new" && (
        <NewProject
          mode={modal.mode}
          onClose={() => setModal(null)}
          onCreate={(data) =>
            act(async () => {
              const created = await api<Project>("project.create", data);
              setModal(null);
              await refresh();
              await openProject(created);
              setModal({ type: "project", value: created });
            })
          }
        />
      )}
      {modal?.type === "project" && (
        <ProjectSettings
          value={modal.value}
          snapshot={snapshot}
          onClose={() => setModal(null)}
          onSave={(value: any) =>
            act(async () => {
              const { id, revision, createdAt, updatedAt, ...patch } = value;
              await api("project.update", { id, revision, patch });
              setModal(null);
              await refresh();
            })
          }
        />
      )}
      {modal?.type === "fact" && (
        <FactForm
          value={modal.value}
          onClose={() => setModal(null)}
          onSave={(value: any) =>
            act(async () => {
              await api("fact.save", value);
              setModal(null);
              await refresh();
            })
          }
          onDelete={() =>
            act(async () => {
              await api("fact.delete", { id: modal.value.id });
              setModal(null);
              await refresh();
            })
          }
        />
      )}
      {modal?.type === "run-details" && (
        <Modal title="任务记录与中断草稿" onClose={() => setModal(null)} wide>
          <p>{modal.run.stage}</p>
          <p className="muted">
            {modal.run.requests} 次调用 ·{" "}
            {(modal.run.inputTokens + modal.run.outputTokens).toLocaleString()}{" "}
            tokens
          </p>
          {modal.run.error && <p className="warning">{modal.run.error}</p>}
          {modal.run.partials.length ? (
            modal.run.partials.map((s: any) => (
              <details key={s.id} open>
                <summary>未完成输出（未自动写入正式正文，可复制保存）</summary>
                <pre className="version-preview">{s.partial}</pre>
              </details>
            ))
          ) : (
            <p className="muted">
              没有中断的输出。已完成结果保存在正文或协作记录中。
            </p>
          )}
        </Modal>
      )}
      {modal?.type === "limits" && (
        <Modal title="任务上限" onClose={() => setModal(null)}>
          <Field label="本次最多模型请求次数">
            <input
              type="number"
              min="1"
              max="10000"
              value={maxRequests}
              onChange={(e) => setMaxRequests(Number(e.target.value))}
            />
          </Field>
          <Field
            label="费用上限（可留空）"
            hint="所有模型价格应使用同一币种。未配置价格时无法启用费用上限；失败请求按预留费用保守计入。"
          >
            <input
              type="number"
              min="0"
              step="0.1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </Field>
          <Button primary onClick={() => setModal(null)}>
            保存
          </Button>
        </Modal>
      )}
      {modal?.type === "export" && (
        <Modal title="导出正式正文" onClose={() => setModal(null)}>
          <Field label="格式">
            <select
              value={modal.format}
              onChange={(e) => setModal({ ...modal, format: e.target.value })}
            >
              <option value="docx">Word 文档（DOCX）</option>
              <option value="pdf">PDF 文档</option>
              <option value="txt">纯文本（TXT）</option>
            </select>
          </Field>
          <Field label="范围">
            <select
              value={modal.range}
              onChange={(e) => setModal({ ...modal, range: e.target.value })}
            >
              <option value="all">全部正式正文</option>
              {chapter && <option value="current">当前章节</option>}
              <option value="selected">指定章节</option>
              {[
                ...new Set(
                  detail?.chapters.map((c) => c.volume).filter(Boolean),
                ),
              ].map((v) => (
                <option key={v} value={"volume:" + v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {modal.range === "selected" && (
            <div className="chapter-picker">
              {detail?.chapters
                .filter((c) => c.status === "final")
                .map((c) => (
                  <label key={c.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={(modal.chapterIds || []).includes(c.id)}
                      onChange={(e) =>
                        setModal({
                          ...modal,
                          chapterIds: e.target.checked
                            ? [...(modal.chapterIds || []), c.id]
                            : modal.chapterIds.filter(
                                (x: string) => x !== c.id,
                              ),
                        })
                      }
                    />
                    {c.title}
                  </label>
                ))}
            </div>
          )}
          <p className="muted">
            草稿、审稿讨论和密钥不包含在导出中。导出期间使用当前正文快照。
          </p>
          <Button
            primary
            disabled={!!busy}
            onClick={() =>
              act(async () => {
                await saveEditor();
                const path = await api("export.save", {
                  projectId,
                  format: modal.format,
                  ...(modal.range === "current"
                    ? { chapterIds: [chapter!.id] }
                    : modal.range === "selected"
                      ? { chapterIds: modal.chapterIds || [] }
                      : modal.range.startsWith("volume:")
                        ? { volume: modal.range.slice(7) }
                        : {}),
                });
                if (path) {
                  notify("已导出：" + path);
                  setModal(null);
                }
              })
            }
          >
            <Download size={16} />
            选择保存位置
          </Button>
        </Modal>
      )}
      {modal?.type === "history" && (
        <Modal title="版本历史" onClose={() => setModal(null)} wide>
          <div className="history-list">
            {modal.versions.map((v: any) => (
              <button
                key={v.version}
                onClick={() =>
                  act(async () =>
                    setModal({
                      ...modal,
                      preview: await api("chapter.version", {
                        id: chapter!.id,
                        version: v.version,
                      }),
                    }),
                  )
                }
              >
                版本 {v.version}
                <span>{stamp(v.created_at)}</span>
              </button>
            ))}
          </div>
          {modal.preview && (
            <>
              <pre className="version-preview">{modal.preview.text}</pre>
              <Button
                primary
                onClick={() =>
                  act(async () => {
                    const c = await api<Chapter>("chapter.restore", {
                      id: chapter!.id,
                      version: modal.preview.version,
                      baseVersion: current.current!.version,
                    });
                    setModal(null);
                    await loadChapter(c.id);
                    await refresh();
                  })
                }
              >
                恢复为新版本
              </Button>
            </>
          )}
        </Modal>
      )}
      {modal?.type === "import" && (
        <ImportPreview
          data={modal.data}
          onClose={() => setModal(null)}
          onCommit={(parts: any) =>
            act(async () => {
              await api("import.commit", { projectId, parts });
              setModal(null);
              await refresh();
              const d = await api<any>("project.detail", { id: projectId });
              if (d.chapters.length) await loadChapter(d.chapters.at(-1).id);
              notify("正文已导入；配置策划模型后可自动提取记忆");
            })
          }
        />
      )}
      {modal?.type === "impact" && (
        <Modal title="确认后文影响范围" onClose={() => setModal(null)}>
          <p>{modal.impact.reason}</p>
          <ul className="impact-list">
            {modal.impact.chapterIds.map((x: string) => (
              <li key={x}>{detail?.chapters.find((c) => c.id === x)?.title}</li>
            ))}
          </ul>
          <p className="muted">
            确认后 AI
            会检查并修订这些章节，保留原版本；审查未通过的结果保留为草稿。
          </p>
          <div className="button-row">
            <Button
              primary
              onClick={() =>
                act(async () => {
                  await api("impact.resolve", {
                    id: modal.impact.id,
                    action: "repair",
                  });
                  setModal(null);
                  await refresh();
                })
              }
            >
              确认检查并修复
            </Button>
            <Button
              onClick={() =>
                act(async () => {
                  await api("impact.resolve", {
                    id: modal.impact.id,
                    action: "dismiss",
                  });
                  setModal(null);
                  await refresh();
                })
              }
            >
              无需处理
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function NewProject({
  mode,
  onClose,
  onCreate,
}: {
  mode: string;
  onClose: () => void;
  onCreate: (value: any) => void;
}) {
  const [value, setValue] = useState({
    title: "",
    mode,
    idea: "",
    genre: "",
    targetWords: mode === "short" ? 8000 : 1000000,
    chapterWords: 3000,
    batchSize: 5,
  });
  return (
    <Modal title="新故事，从这里开始" onClose={onClose}>
      <div className="segmented">
        <button
          className={value.mode === "long" ? "active" : ""}
          onClick={() =>
            setValue({ ...value, mode: "long", targetWords: 1000000 })
          }
        >
          长篇连载
        </button>
        <button
          className={value.mode === "short" ? "active" : ""}
          onClick={() =>
            setValue({ ...value, mode: "short", targetWords: 8000 })
          }
        >
          短篇小说
        </button>
      </div>
      <Field label="作品名称">
        <input
          autoFocus
          placeholder="给故事起一个名字"
          value={value.title}
          onChange={(e) => setValue({ ...value, title: e.target.value })}
        />
      </Field>
      <Field label="你的创意">
        <textarea
          rows={5}
          placeholder="一个人物、一个困境，或一个你一直想写的念头……"
          value={value.idea}
          onChange={(e) => setValue({ ...value, idea: e.target.value })}
        />
      </Field>
      <div className="form-grid">
        <Field label="题材">
          <input
            placeholder="例如：都市悬疑"
            value={value.genre}
            onChange={(e) => setValue({ ...value, genre: e.target.value })}
          />
        </Field>
        <Field label="目标字数">
          <input
            type="number"
            min={value.mode === "short" ? 3000 : 1000}
            max={value.mode === "short" ? 20000 : 10000000}
            value={value.targetWords}
            onChange={(e) =>
              setValue({ ...value, targetWords: Number(e.target.value) })
            }
          />
        </Field>
      </div>
      <Button
        primary
        disabled={!value.title.trim()}
        onClick={() => onCreate(value)}
      >
        创建作品 <ArrowUpRight size={16} />
      </Button>
    </Modal>
  );
}
function ProjectSettings({
  value,
  snapshot,
  onClose,
  onSave,
}: {
  value: Project;
  snapshot: Snapshot;
  onClose: () => void;
  onSave: (v: Project) => void;
}) {
  const [p, setP] = useState(value);
  const change = (key: string, value: any) =>
    setP((x) => ({ ...x, [key]: value }));
  const select = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">请选择模型</option>
      {snapshot.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} · {m.model}
        </option>
      ))}
    </select>
  );
  return (
    <Modal title="创作配置" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="作品名称">
          <input
            value={p.title}
            onChange={(e) => change("title", e.target.value)}
          />
        </Field>
        <Field label="题材">
          <input
            value={p.genre}
            onChange={(e) => change("genre", e.target.value)}
          />
        </Field>
      </div>
      <Field label="创意 / 创作方向">
        <textarea
          rows={3}
          value={p.idea}
          onChange={(e) => change("idea", e.target.value)}
        />
      </Field>
      <div className="form-grid">
        <Field label="目标读者">
          <input
            value={p.audience}
            onChange={(e) => change("audience", e.target.value)}
          />
        </Field>
        <Field label="语言风格">
          <input
            value={p.style}
            onChange={(e) => change("style", e.target.value)}
          />
        </Field>
      </div>
      <Field label="创作禁区与不可改动要求">
        <textarea
          value={p.forbidden}
          onChange={(e) => change("forbidden", e.target.value)}
        />
      </Field>
      <div className="form-grid three">
        <Field label="全篇目标字数">
          <input
            type="number"
            value={p.targetWords}
            onChange={(e) => change("targetWords", +e.target.value)}
          />
        </Field>
        {p.mode === "long" && (
          <>
            <Field label="每章目标字数">
              <input
                type="number"
                value={p.chapterWords}
                onChange={(e) => change("chapterWords", +e.target.value)}
              />
            </Field>
            <Field label="每批章节数">
              <input
                type="number"
                min="1"
                max="30"
                value={p.batchSize}
                onChange={(e) => change("batchSize", +e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
      <h3>创作团队</h3>
      {!snapshot.models.length && (
        <p className="warning">
          尚未接入模型。可先保存，到“模型与设置”添加后再绑定。
        </p>
      )}
      <div className="form-grid">
        <Field label="策划模型">
          {select(p.roles.planner, (v) =>
            change("roles", { ...p.roles, planner: v }),
          )}
        </Field>
        <Field label="主笔模型">
          {select(p.roles.writer, (v) =>
            change("roles", { ...p.roles, writer: v }),
          )}
        </Field>
      </div>
      <Field label="审稿 AI 数量">
        <select
          value={p.roles.reviewers.length}
          onChange={(e) =>
            change("roles", {
              ...p.roles,
              reviewers:
                +e.target.value === 1
                  ? [p.roles.reviewers[0]]
                  : [p.roles.reviewers[0], p.roles.reviewers[1] || ""],
            })
          }
        >
          <option value="1">1 个 AI · 综合审查</option>
          <option value="2">2 个 AI · 独立审查并交换意见</option>
        </select>
      </Field>
      {p.roles.reviewers.map((v, i) => (
        <div className="form-grid" key={i}>
          <Field label={`审稿 ${i + 1}`}>
            {select(v, (x) =>
              change("roles", {
                ...p.roles,
                reviewers: p.roles.reviewers.map((m, j) => (i === j ? x : m)),
              }),
            )}
          </Field>
          <Field label="审稿侧重点（可选）">
            <input
              placeholder="如：人物动机、伏笔与时间线"
              value={p.roles.reviewerPrompts[i] || ""}
              onChange={(e) =>
                change("roles", {
                  ...p.roles,
                  reviewerPrompts: [0, 1].map((j) =>
                    i === j ? e.target.value : p.roles.reviewerPrompts[j] || "",
                  ),
                })
              }
            />
          </Field>
        </div>
      ))}
      <details>
        <summary>角色提示词与大纲</summary>
        <Field label="策划补充要求">
          <textarea
            value={p.roles.plannerPrompt}
            onChange={(e) =>
              change("roles", { ...p.roles, plannerPrompt: e.target.value })
            }
          />
        </Field>
        <Field label="主笔补充要求">
          <textarea
            value={p.roles.writerPrompt}
            onChange={(e) =>
              change("roles", { ...p.roles, writerPrompt: e.target.value })
            }
          />
        </Field>
        <Field label="已有大纲">
          <textarea
            rows={5}
            value={p.outline}
            onChange={(e) => change("outline", e.target.value)}
          />
        </Field>
      </details>
      <h3>写作 Skills</h3>
      <p>
        在「模型与设置」导入 SKILL.md；每个角色最多启用 5 个，两个审稿 AI
        共用审稿 Skills。未启用的 Skill 不发送给模型。
      </p>
      {(["planner", "writer", "reviewer"] as const).map((role) => (
        <fieldset key={role}>
          <legend>
            {{ planner: "策划", writer: "主笔", reviewer: "审稿" }[role]}
          </legend>
          {snapshot.skills.map((skill) => (
            <label className="checkbox-row" key={skill.id}>
              <input
                type="checkbox"
                checked={(p.skillBindings?.[role] || []).includes(skill.id)}
                onChange={(e) => {
                  const ids = p.skillBindings?.[role] || [];
                  change("skillBindings", {
                    ...p.skillBindings,
                    [role]: e.target.checked
                      ? [...ids, skill.id]
                      : ids.filter((id) => id !== skill.id),
                  });
                }}
              />
              {skill.name} · v{skill.version}
            </label>
          ))}
        </fieldset>
      ))}
      <h3>应用写作模板</h3>
      {snapshot.templates.length ? (
        snapshot.templates.map((t) => (
          <label className="checkbox-row" key={t.id}>
            <input
              type="checkbox"
              checked={p.templateIds.includes(t.id)}
              onChange={(e) =>
                change(
                  "templateIds",
                  e.target.checked
                    ? [...p.templateIds, t.id]
                    : p.templateIds.filter((x) => x !== t.id),
                )
              }
            />
            {t.title}
          </label>
        ))
      ) : (
        <p className="muted">在“参考与方法”分析作品后，模板会出现在这里。</p>
      )}
      <div className="form-grid three">
        {[
          ["structure", "结构"],
          ["rhythm", "节奏"],
          ["language", "语言特征"],
        ].map(([k, label]) => (
          <Field
            key={k}
            label={`${label}参考强度 ${p.influence[k as keyof typeof p.influence]}%`}
          >
            <input
              type="range"
              min="0"
              max="100"
              value={p.influence[k as keyof typeof p.influence]}
              onChange={(e) =>
                change("influence", { ...p.influence, [k]: +e.target.value })
              }
            />
          </Field>
        ))}
      </div>
      <Button primary onClick={() => onSave(p)}>
        保存配置
      </Button>
    </Modal>
  );
}
function FactForm({ value, onSave, onClose, onDelete }: any) {
  const [f, setF] = useState(value);
  return (
    <Modal title="故事设定" onClose={onClose}>
      <div className="form-grid">
        <Field label="类别">
          <select
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            {["人物", "关系", "时间线", "规则", "伏笔"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        <Field label="名称">
          <input
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </Field>
      </div>
      <Field label="详情与证据">
        <textarea
          rows={6}
          value={f.detail}
          onChange={(e) => setF({ ...f, detail: e.target.value })}
        />
      </Field>
      <Field label="别名（逗号分隔）">
        <input
          value={f.aliases.join(",")}
          onChange={(e) =>
            setF({
              ...f,
              aliases: e.target.value.split(/[,，]/).filter(Boolean),
            })
          }
        />
      </Field>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={f.locked}
          onChange={(e) => setF({ ...f, locked: e.target.checked })}
        />
        锁定，AI 不得自行改动
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={f.planned}
          onChange={(e) => setF({ ...f, planned: e.target.checked })}
        />
        这是未来计划，尚未发生
      </label>
      <div className="button-row">
        <Button primary onClick={() => onSave(f)}>
          保存
        </Button>
        {f.id && <Button onClick={onDelete}>删除</Button>}
      </div>
    </Modal>
  );
}
function ImportPreview({ data, onClose, onCommit }: any) {
  const [parts, setParts] = useState(data.parts);
  const [index, setIndex] = useState(0);
  return (
    <Modal title={`导入预览 · ${data.name}`} onClose={onClose} wide>
      <p className="muted">
        检测到 {parts.length} 个章节 /
        片段。可修改标题、正文，或与上一段合并。短篇导入时会合并成整篇。
      </p>
      <div className="form-grid">
        <div className="import-list">
          {parts.map((p: any, i: number) => (
            <button
              className={index === i ? "active" : ""}
              key={i}
              onClick={() => setIndex(i)}
            >
              {i + 1}. {p.title} <small>{count(p.text)} 字</small>
            </button>
          ))}
        </div>
        <div>
          <Field label="标题">
            <input
              value={parts[index]?.title || ""}
              onChange={(e) =>
                setParts(
                  parts.map((p: any, i: number) =>
                    i === index ? { ...p, title: e.target.value } : p,
                  ),
                )
              }
            />
          </Field>
          <textarea
            className="import-text"
            value={parts[index]?.text || ""}
            onChange={(e) =>
              setParts(
                parts.map((p: any, i: number) =>
                  i === index ? { ...p, text: e.target.value } : p,
                ),
              )
            }
          />
          <Button
            disabled={index === 0}
            onClick={() => {
              const next = [...parts];
              next[index - 1] = {
                ...next[index - 1],
                text: next[index - 1].text + "\n\n" + next[index].text,
              };
              next.splice(index, 1);
              setParts(next);
              setIndex(index - 1);
            }}
          >
            与上一段合并
          </Button>
        </div>
      </div>
      <Button primary onClick={() => onCommit(parts)}>
        确认导入
      </Button>
    </Modal>
  );
}
function SettingsPage({ snapshot, refresh, act, notify }: any) {
  const [editing, setEditing] = useState<any>(null);
  const [brave, setBrave] = useState("");
  const blank = {
    name: "",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "",
    key: "",
    contextLimit: 32000,
    outputLimit: 4096,
    inputPrice: undefined,
    outputPrice: undefined,
  };
  return (
    <div className="content-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">你的 AI 团队</div>
          <h1>模型与设置</h1>
          <p>选择适合每个角色的模型，让创作方式由你决定。</p>
        </div>
        <Button primary onClick={() => setEditing(blank)}>
          <Plus size={16} />
          添加模型
        </Button>
      </div>
      <SkillsLibrary snapshot={snapshot} refresh={refresh} act={act} />
      <div className="settings-models">
        {snapshot.models.map((m: ModelConfig) => (
          <div className="model-card" key={m.id}>
            <div className="model-icon">
              <Sparkles size={21} />
            </div>
            <div>
              <h3>{m.name}</h3>
              <p>{m.model}</p>
              <small>
                {m.protocol === "openai"
                  ? "OpenAI 兼容"
                  : m.protocol === "gemini"
                    ? "Gemini 原生"
                    : "Anthropic 原生"}{" "}
                · {m.hasKey ? "密钥已保存" : "未配置密钥"}
              </small>
            </div>
            <div className="button-row">
              <Button
                onClick={() =>
                  act(async () => {
                    const result = await api("model.test", { id: m.id });
                    notify(
                      `${m.name}：${result.text}（${result.inputTokens + result.outputTokens} tokens）`,
                    );
                  })
                }
              >
                测试连接
              </Button>
              <Button onClick={() => setEditing({ ...m, key: "" })}>
                编辑
              </Button>
              <button
                className="icon-btn"
                title="删除模型配置"
                onClick={() =>
                  act(async () => {
                    await api("model.delete", { id: m.id });
                    await refresh();
                  })
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!snapshot.models.length && (
        <div className="empty-shelf compact">
          <Users size={32} />
          <h3>还没有模型连接</h3>
          <p>添加 API 地址、模型名称和密钥。可以为同一家服务添加多个模型。</p>
        </div>
      )}
      <div className="settings-section">
        <div>
          <h2>参考搜索</h2>
          <p>
            配置 Brave Search，启用自动搜索参考作品。搜索和模型调用分别计费。
          </p>
        </div>
        <Field
          label={`Brave API 密钥 · ${snapshot.searchConfigured ? "已配置" : "未配置"}`}
        >
          <div className="inline-field">
            <input
              type="password"
              autoComplete="off"
              placeholder="输入新密钥"
              value={brave}
              onChange={(e) => setBrave(e.target.value)}
            />
            <Button
              disabled={!brave}
              onClick={() =>
                act(async () => {
                  await api("secret.brave", { key: brave });
                  setBrave("");
                  await refresh();
                  notify("搜索密钥已加密保存");
                })
              }
            >
              保存
            </Button>
          </div>
        </Field>
      </div>
      <div className="settings-section">
        <h2>本地数据</h2>
        <p>
          备份包含作品、历史版本、参考资料和模板，不包含 API
          密钥。恢复时不会覆盖已存在的作品；恢复后需重新绑定模型。
        </p>
        <div className="button-row">
          <Button
            onClick={() =>
              act(async () => {
                const path = await api("backup.save");
                if (path) notify("备份已保存：" + path);
              })
            }
          >
            <Download size={15} />
            备份项目
          </Button>
          <Button
            onClick={() =>
              act(async () => {
                if (await api("backup.open")) {
                  await refresh();
                  notify("备份已恢复，请检查角色绑定");
                }
              })
            }
          >
            <Upload size={15} />
            恢复备份
          </Button>
          <Button onClick={() => act(() => api("app.directory"))}>
            <FolderOpen size={15} />
            打开数据目录
          </Button>
        </div>
      </div>
      <p className="privacy-note">
        正文编辑与导出在本机完成。生成时必要内容会发送到你配置的模型服务；自动搜索会发送题材查询。密钥使用
        Windows 加密保护，不包含在项目备份中。
      </p>
      {editing && (
        <Modal
          title={editing.id ? "编辑模型" : "添加模型连接"}
          onClose={() => setEditing(null)}
        >
          <Field label="显示名称">
            <input
              autoFocus
              placeholder="例如：我的主笔模型"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </Field>
          <Field label="接口协议">
            <select
              value={editing.protocol}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  protocol: e.target.value,
                  baseUrl:
                    e.target.value === "gemini"
                      ? "https://generativelanguage.googleapis.com/v1beta"
                      : e.target.value === "anthropic"
                        ? "https://api.anthropic.com/v1"
                        : "https://api.openai.com/v1",
                })
              }
            >
              <option value="openai">OpenAI 兼容（支持 DeepSeek 等）</option>
              <option value="gemini">Gemini 原生</option>
              <option value="anthropic">Anthropic 原生</option>
            </select>
          </Field>
          <Field
            label="API Base URL"
            hint="填写接口根路径，例如 https://api.deepseek.com；兼容服务常为 /v1 结尾。"
          >
            <input
              value={editing.baseUrl}
              onChange={(e) =>
                setEditing({ ...editing, baseUrl: e.target.value })
              }
            />
          </Field>
          <Field label="模型 ID">
            <input
              placeholder="填写服务商提供的实际模型名称"
              value={editing.model}
              onChange={(e) =>
                setEditing({ ...editing, model: e.target.value })
              }
            />
          </Field>
          <Field
            label="API 密钥"
            hint={
              editing.hasKey
                ? "已保存密钥，留空表示不修改。"
                : "密钥仅加密保存在本机。"
            }
          >
            <input
              type="password"
              autoComplete="off"
              value={editing.key}
              onChange={(e) => setEditing({ ...editing, key: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="上下文上限（tokens）">
              <input
                type="number"
                value={editing.contextLimit}
                onChange={(e) =>
                  setEditing({ ...editing, contextLimit: +e.target.value })
                }
              />
            </Field>
            <Field label="单次输出上限（tokens）">
              <input
                type="number"
                value={editing.outputLimit}
                onChange={(e) =>
                  setEditing({ ...editing, outputLimit: +e.target.value })
                }
              />
            </Field>
          </div>
          <div className="form-grid">
            <Field label="输入价格 / 百万 tokens">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="可留空"
                value={editing.inputPrice ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    inputPrice:
                      e.target.value === "" ? undefined : +e.target.value,
                  })
                }
              />
            </Field>
            <Field label="输出价格 / 百万 tokens">
              <input
                type="number"
                step="any"
                min="0"
                placeholder="可留空"
                value={editing.outputPrice ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    outputPrice:
                      e.target.value === "" ? undefined : +e.target.value,
                  })
                }
              />
            </Field>
          </div>
          <small className="muted">
            价格由你维护，所有模型使用同一币种。请按服务商当前限制填写。
          </small>
          <div className="modal-actions">
            <Button
              primary
              onClick={() =>
                act(async () => {
                  await api("model.save", editing);
                  setEditing(null);
                  await refresh();
                  notify("模型配置已保存");
                })
              }
            >
              保存模型
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ReferencesPage({
  snapshot,
  refresh,
  act,
  notify,
  settingsSelect,
}: any) {
  const [query, setQuery] = useState("");
  const [freshness, setFreshness] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [tab, setTab] = useState("sources");
  const [editing, setEditing] = useState<any>(null);
  const [template, setTemplate] = useState<any>(null);
  const [link, setLink] = useState("");
  const [learning, setLearning] = useState<Run | null>(null);
  const [history, setHistory] = useState<any>(null);
  const newRef = {
    title: "",
    text: "",
    url: "",
    scope: "excerpt",
    evidence: "",
    analyzed: "",
  };
  useEffect(() => {
    if (!learning?.id) return;
    const t = setInterval(() => {
      void api<Run>("run.get", { id: learning.id })
        .then((r) => {
          setLearning(r);
          if (r.data.kind === "search" && r.data.candidates) {
            setResults(r.data.candidates);
            if (r.status === "running") setSelected(r.data.referenceIds || []);
          }
        })
        .catch((e) => notify(e.message));
    }, 1800);
    return () => clearInterval(t);
  }, [learning?.id]);
  useEffect(() => {
    if (!learning && snapshot.referenceRuns?.length) {
      const run =
        snapshot.referenceRuns.find((r: Run) =>
          ["running", "paused", "waiting"].includes(r.status),
        ) || snapshot.referenceRuns[0];
      setLearning(run);
      if (run.data.candidates) setResults(run.data.candidates);
      if (run.data.referenceIds) setSelected(run.data.referenceIds);
    }
  }, [snapshot.referenceRuns, learning]);
  return (
    <div className="content-page reference-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">读懂方法，再创造</div>
          <h1>参考与方法</h1>
          <p>从好故事中提炼结构、节奏和语言特征，建立自己的写作方法库。</p>
        </div>
        <div className="button-row">
          <Button
            onClick={() =>
              act(async () => {
                const data = await api("import.preview");
                if (data)
                  setEditing({
                    ...newRef,
                    title: data.name.replace(/\.(txt|docx)$/i, ""),
                    text: data.parts
                      .map((p: any) => p.title + "\n" + p.text)
                      .join("\n\n"),
                    scope: "full",
                  });
              })
            }
          >
            <Upload size={16} />
            导入文件
          </Button>
          <Button primary onClick={() => setEditing(newRef)}>
            <Plus size={16} />
            粘贴参考
          </Button>
        </div>
      </div>
      <div className="reference-search">
        <div className="search-heading">
          <Sparkles size={21} />
          <div>
            <h3>让 AI 寻找并学习参考作品</h3>
            <p>输入题材、读者与参考偏好；仅依据实际取得的内容分析。</p>
          </div>
        </div>
        <div className="search-row">
          <input
            placeholder="例如：面向成年读者的都市悬疑短篇，重视伏笔和结尾反转"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="参考搜索时间范围"
            value={freshness}
            onChange={(e) => setFreshness(e.target.value)}
          >
            <option value="">不限时间</option>
            <option value="pd">最近一天</option>
            <option value="pw">最近一周</option>
            <option value="pm">最近一个月</option>
            <option value="py">最近一年</option>
          </select>
          <Button
            disabled={!query}
            onClick={() =>
              act(async () =>
                setResults(await api("reference.search", { query, freshness })),
              )
            }
          >
            <Search size={15} />
            搜索候选
          </Button>
        </div>
        <div className="search-row">
          {settingsSelect(model, setModel)}
          <Button
            primary
            disabled={!query || !model}
            onClick={() =>
              act(async () => {
                const result = await api("reference.auto", {
                  query,
                  modelId: model,
                  freshness,
                });
                setResults(result.candidates);
                setSelected(result.selected);
                setLearning(result.run);
                await refresh();
                notify("已开始搜索并提取参考，候选和读取范围会随进度显示。");
              })
            }
          >
            自动搜索并学习
          </Button>
          <small>最多 3 次查询 · 学习最多 3 份资料</small>
        </div>
        {!snapshot.searchConfigured && (
          <p className="warning">
            自动搜索需要在“模型与设置”中配置 Brave
            密钥；本地导入不需要搜索服务。
          </p>
        )}
      </div>
      {learning && (
        <div className="learning-status">
          <select
            aria-label="参考学习任务历史"
            value={learning.id}
            onChange={(e) => {
              const run = snapshot.referenceRuns.find(
                (r: Run) => r.id === e.target.value,
              );
              if (run) {
                setLearning(run);
                setResults(run.data.candidates || []);
                setSelected(run.data.referenceIds || []);
              }
            }}
          >
            {(snapshot.referenceRuns || []).map((r: Run) => (
              <option key={r.id} value={r.id}>
                {stamp(r.createdAt)} · {statusText[r.status]}
              </option>
            ))}
          </select>
          <span className="dot" />
          {statusText[learning.status]} · {learning.stage}
          {learning.error && <span className="warning">{learning.error}</span>}
          {!!learning.data.failures?.length && (
            <details>
              <summary>{learning.data.failures.length} 个网页读取失败</summary>
              {learning.data.failures.map((f: any) => (
                <p key={f.url}>
                  {f.url}：{f.error}
                </p>
              ))}
            </details>
          )}
          {learning.status === "running" ? (
            <Button
              onClick={() =>
                act(async () => {
                  await api("run.pause", { id: learning.id });
                  setLearning(await api("run.get", { id: learning.id }));
                })
              }
            >
              暂停
            </Button>
          ) : (
            ["waiting", "paused"].includes(learning.status) && (
              <Button
                onClick={() =>
                  act(async () => {
                    await api("run.resume", {
                      id: learning.id,
                      maxRequests: learning.maxRequests + 100,
                      budget: learning.budget,
                    });
                    setLearning(await api("run.get", { id: learning.id }));
                  })
                }
              >
                继续
              </Button>
            )
          )}
          {["running", "waiting", "paused"].includes(learning.status) && (
            <Button
              onClick={() =>
                act(async () => {
                  await api("run.cancel", { id: learning.id });
                  setLearning(await api("run.get", { id: learning.id }));
                })
              }
            >
              取消
            </Button>
          )}
        </div>
      )}
      {!!results.length && (
        <details className="search-results" open>
          <summary>搜索候选 · {results.length} 条</summary>
          {results.map((r) => (
            <div key={r.url}>
              <div>
                <h4>{r.title}</h4>
                <small>{r.url}</small>
                <p>{r.description}</p>
                <em>{r.reason}</em>
              </div>
              <Button
                onClick={() =>
                  act(async () => {
                    const ref = await api("reference.fetch", { url: r.url });
                    setSelected((x) => [...new Set([...x, ref.id])].slice(-3));
                    await refresh();
                    notify("已读取网页，请核实实际内容范围");
                  })
                }
              >
                读取正文
              </Button>
            </div>
          ))}
        </details>
      )}
      <div className="reference-link">
        <input
          placeholder="或者粘贴公开网页链接（https://…）"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <Button
          disabled={!link}
          onClick={() =>
            act(async () => {
              const ref = await api("reference.fetch", { url: link });
              setEditing({ ...ref, baseVersion: ref.version });
              setLink("");
              await refresh();
            })
          }
        >
          读取网页
        </Button>
      </div>
      <div className="section-title">
        <div className="tab-heading">
          <button
            className={tab === "sources" ? "active" : ""}
            onClick={() => setTab("sources")}
          >
            参考作品 <span>{snapshot.references.length}</span>
          </button>
          <button
            className={tab === "templates" ? "active" : ""}
            onClick={() => setTab("templates")}
          >
            写作模板 <span>{snapshot.templates.length}</span>
          </button>
        </div>
        {tab === "sources" && (
          <Button
            disabled={!selected.length || !model}
            onClick={() =>
              act(async () => {
                const r = await api("reference.analyze", {
                  ids: selected,
                  modelId: model,
                });
                setLearning(r);
                notify("开始提炼参考作品，请在上方查看进度");
              })
            }
          >
            学习选中资料（{selected.length}/3）
          </Button>
        )}
      </div>
      {tab === "sources" ? (
        <div className="reference-grid">
          {snapshot.references.map((r: Reference) => (
            <div className="reference-card" key={r.id}>
              <div className="reference-card-head">
                <input
                  type="checkbox"
                  aria-label={`选择 ${r.title}`}
                  checked={selected.includes(r.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, r.id].slice(-3)
                        : selected.filter((x) => x !== r.id),
                    )
                  }
                />
                <span className="tag">
                  {r.scope === "full"
                    ? "用户提供全文"
                    : r.scope === "summary"
                      ? "简介 / 摘要"
                      : "节选 / 网页"}
                </span>
                <span className="muted">v{r.version}</span>
              </div>
              <h3>{r.title}</h3>
              <p>
                {r.analyzed
                  ? "已提炼写作方法"
                  : r.evidence || "相关参考 · 热度未核实"}
              </p>
              <small className="source-url">{r.url || "本地资料"}</small>
              <div className="button-row">
                <Button
                  onClick={() =>
                    act(async () => {
                      const ref = await api("reference.get", { id: r.id });
                      setEditing({ ...ref, baseVersion: ref.version });
                    })
                  }
                >
                  查看与编辑
                </Button>
                <button
                  className="icon-btn"
                  title="删除参考资料"
                  onClick={() =>
                    act(async () => {
                      await api("reference.delete", { id: r.id });
                      setSelected((x) => x.filter((i) => i !== r.id));
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          {!snapshot.references.length && (
            <div className="empty-shelf compact">
              <BookMarked size={31} />
              <h3>还没有参考资料</h3>
              <p>搜索、导入或粘贴一份你想学习的作品。</p>
            </div>
          )}
        </div>
      ) : (
        <div className="reference-grid">
          {snapshot.templates.map((t: Template) => (
            <div className="reference-card" key={t.id}>
              <span className="tag">写作方法 · v{t.version}</span>
              <h3>{t.title}</h3>
              <p>{t.content.slice(0, 140)}</p>
              <Button onClick={() => setTemplate(t)}>查看与编辑</Button>
            </div>
          ))}
          {!snapshot.templates.length && (
            <div className="empty-shelf compact">
              <Sparkles size={30} />
              <h3>学习之后，方法留在这里。</h3>
              <p>选中资料和策划模型，点击“学习选中资料”。</p>
            </div>
          )}
        </div>
      )}
      {editing && (
        <Modal title="参考作品卡" onClose={() => setEditing(null)} wide>
          <Button
            onClick={() =>
              act(async () =>
                setHistory({
                  kind: "reference",
                  current: editing,
                  versions: await api("reference.versions", { id: editing.id }),
                }),
              )
            }
            disabled={!editing.id}
          >
            <History size={14} />
            历史版本
          </Button>
          <Field label="标题">
            <input
              value={editing.title}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="来源链接">
              <input
                value={editing.url}
                onChange={(e) =>
                  setEditing({ ...editing, url: e.target.value })
                }
              />
            </Field>
            <Field label="实际内容范围">
              <select
                value={editing.scope}
                onChange={(e) =>
                  setEditing({ ...editing, scope: e.target.value })
                }
              >
                <option value="full">已提供全文</option>
                <option value="excerpt">节选 / 当前网页内容</option>
                <option value="summary">简介 / 摘要</option>
              </select>
            </Field>
          </div>
          <Field label="热度证据及时间（未核实时留空）">
            <textarea
              placeholder="写明榜单名称、页面链接、日期及实际指标，不以搜索排名代替。"
              value={editing.evidence}
              onChange={(e) =>
                setEditing({ ...editing, evidence: e.target.value })
              }
            />
          </Field>
          <Field label="参考正文">
            <textarea
              className="reference-text"
              value={editing.text}
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
          </Field>
          <Field
            label="学习分析（可修改或清空）"
            hint="修改参考正文后，未同步修改的旧分析会清空，可重新学习。"
          >
            <textarea
              className="reference-text"
              value={editing.analyzed || ""}
              onChange={(e) =>
                setEditing({ ...editing, analyzed: e.target.value })
              }
            />
          </Field>
          <Button
            primary
            onClick={() =>
              act(async () => {
                await api("reference.save", editing);
                setEditing(null);
                await refresh();
              })
            }
          >
            保存参考资料
          </Button>
        </Modal>
      )}
      {history && (
        <Modal
          title="资料版本历史"
          layer={110}
          onClose={() => setHistory(null)}
          wide
        >
          <div className="history-list">
            {history.versions.map((v: any) => (
              <button
                key={v.version}
                onClick={() =>
                  act(async () =>
                    setHistory({
                      ...history,
                      preview: await api(history.kind + ".version", {
                        id: history.current.id,
                        version: v.version,
                      }),
                    }),
                  )
                }
              >
                版本 {v.version}
                <span>{stamp(v.created_at)}</span>
              </button>
            ))}
          </div>
          {history.preview && (
            <>
              <pre className="version-preview">
                {history.preview.content || history.preview.text}
              </pre>
              <Button
                primary
                onClick={() => {
                  if (history.kind === "reference")
                    setEditing({
                      ...history.preview,
                      version: history.current.version,
                      baseVersion: history.current.version,
                    });
                  else
                    setTemplate({
                      ...history.preview,
                      version: history.current.version,
                    });
                  setHistory(null);
                  notify("已载入历史版本，点击保存后生效");
                }}
              >
                载入此版本
              </Button>
            </>
          )}
        </Modal>
      )}
      {template && (
        <Modal title="写作模板" onClose={() => setTemplate(null)} wide>
          <Button
            onClick={() =>
              act(async () =>
                setHistory({
                  kind: "template",
                  current: template,
                  versions: await api("template.versions", { id: template.id }),
                }),
              )
            }
          >
            <History size={14} />
            历史版本
          </Button>
          <Field label="模板名称">
            <input
              value={template.title}
              onChange={(e) =>
                setTemplate({ ...template, title: e.target.value })
              }
            />
          </Field>
          <Field label="写作方法">
            <textarea
              className="reference-text"
              value={template.content}
              onChange={(e) =>
                setTemplate({ ...template, content: e.target.value })
              }
            />
          </Field>
          <p className="muted">
            在作品的“创作配置”中勾选此模板，分别调整结构、节奏和语言特征的参考强度。
          </p>
          <div className="button-row">
            <Button
              primary
              onClick={() =>
                act(async () => {
                  await api("template.save", {
                    id: template.id,
                    baseVersion: template.version,
                    title: template.title,
                    content: template.content,
                  });
                  setTemplate(null);
                  await refresh();
                })
              }
            >
              保存模板
            </Button>
            <Button
              onClick={() =>
                act(async () => {
                  await api("template.delete", { id: template.id });
                  setTemplate(null);
                  await refresh();
                })
              }
            >
              删除模板
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SkillsLibrary({ snapshot, refresh, act }: any) {
  const [sourceProject, setSourceProject] = useState("");
  const [targetSkill, setTargetSkill] = useState("");
  const [draft, setDraft] = useState<any>(null);
  return (
    <section className="settings-section">
      <h2>写作 Skills 库</h2>
      <h3>从写作过程自我更新</h3>
      <p>
        策划模型读取最近 5 章的摘要与开头节选，以及最近 8 条讨论记录，提出新
        Skill 或更新草案。采纳后产生新版本；已绑定的作品后续使用新版，新 Skill
        需在创作配置中启用。任务可在作品中暂停或继续。
      </p>
      <Field label="复盘作品">
        <select
          value={sourceProject}
          onChange={(e) => setSourceProject(e.target.value)}
        >
          <option value="">选择作品</option>
          {snapshot.projects.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="更新目标 Skill">
        <select
          value={targetSkill}
          onChange={(e) => setTargetSkill(e.target.value)}
        >
          <option value="">生成新的 Skill</option>
          {snapshot.skills.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name} · v{s.version}
            </option>
          ))}
        </select>
      </Field>
      <Button
        disabled={!sourceProject}
        onClick={() =>
          act(async () => {
            await api("skill.evolve", {
              projectId: sourceProject,
              ...(targetSkill ? { skillId: targetSkill } : {}),
            });
            await refresh();
          })
        }
      >
        从写作记录提炼 Skill
      </Button>
      {snapshot.skillSuggestions
        .filter((s: any) => s.status === "pending")
        .map((s: any) => (
          <details className="reference-card" key={s.id}>
            <summary>
              待采纳：{s.name} · {s.skillId ? "更新" : "新 Skill"}
            </summary>
            <p>{s.reason}</p>
            <p>证据 ID：{s.evidenceIds.join("、")}</p>
            <div className="form-grid">
              <Field label="更新前">
                <textarea
                  readOnly
                  rows={10}
                  value={s.previousContent || "（新 Skill）"}
                />
              </Field>
              <Field label="建议版本">
                <textarea readOnly rows={10} value={s.content} />
              </Field>
            </div>
            <Button
              onClick={() =>
                act(async () => {
                  await api("skill.accept", { id: s.id });
                  await refresh();
                })
              }
            >
              采纳 Skill 建议
            </Button>
            <Button
              onClick={() =>
                act(async () => {
                  await api("skill.reject", { id: s.id });
                  await refresh();
                })
              }
            >
              拒绝 Skill 建议
            </Button>
          </details>
        ))}
      <p>
        导入 UTF-8 的 SKILL.md 或 .md
        指令文件，预览后保存，再到作品「创作配置」为角色启用。每份最多 24000
        字符。此版应用指令正文，不加载关联文件或运行
        scripts；请将必要的参考规则整理进正文。Skills 将发送给对应在线模型。
      </p>
      <input
        aria-label="导入 Skill"
        type="file"
        accept=".md,.txt"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file)
            act(async () => {
              if (file.size > 100000)
                throw new Error("Skill 文件过大（最多 100 KB）");
              const content = await file.text();
              if (content.includes("\ufffd") || content.includes("\0"))
                throw new Error("请使用 UTF-8 文本文件");
              const name =
                content.match(/^name:\s*["']?([^\r\n"']+)/m)?.[1]?.trim() ||
                file.name.replace(/\.(md|txt)$/i, "");
              setDraft({ name, content });
            });
        }}
      />
      {snapshot.skills.map((s: any) => (
        <div className="reference-card" key={s.id}>
          <strong>
            {s.name} · v{s.version}
          </strong>
          <p>SHA-256：{s.hash}</p>
          <Button onClick={() => setDraft({ ...s, baseVersion: s.version })}>
            查看 / 编辑 Skill
          </Button>
          <Button
            onClick={() =>
              act(async () => {
                await api("skill.delete", { id: s.id });
                await refresh();
              })
            }
          >
            移除 Skill
          </Button>
        </div>
      ))}
      {draft && (
        <Modal title="Skill 导入预览与编辑" onClose={() => setDraft(null)} wide>
          <Field label="Skill 名称">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Skill 指令正文">
            <textarea
              rows={18}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
          </Field>
          <p>{draft.content.length} / 24000 字符 · 不会自动执行文件中的命令</p>
          <Button
            primary
            onClick={() =>
              act(async () => {
                await api("skill.save", draft);
                setDraft(null);
                await refresh();
              })
            }
          >
            保存 Skill
          </Button>
        </Modal>
      )}
    </section>
  );
}
