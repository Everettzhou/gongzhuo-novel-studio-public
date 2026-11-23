export type Protocol = "openai" | "gemini" | "anthropic";
export interface ModelConfig {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
  inputPrice?: number;
  outputPrice?: number;
  hasKey?: boolean;
}
export interface Roles {
  planner: string;
  writer: string;
  reviewers: string[];
  plannerPrompt: string;
  writerPrompt: string;
  reviewerPrompts: string[];
}
export interface Skill {
  id: string;
  name: string;
  content: string;
  version: number;
  hash: string;
  createdAt: string;
}
export type SkillRole = "planner" | "writer" | "reviewer";
export interface Project {
  skillBindings?: Partial<Record<SkillRole, string[]>>;
  id: string;
  title: string;
  mode: "long" | "short";
  idea: string;
  genre: string;
  audience: string;
  style: string;
  forbidden: string;
  targetWords: number;
  chapterWords: number;
  batchSize: number;
  roles: Roles;
  outline: string;
  revision: number;
  templateIds: string[];
  influence: { structure: number; rhythm: number; language: number };
  createdAt: string;
  updatedAt: string;
}
export interface Chapter {
  id: string;
  projectId: string;
  ordinal: number;
  title: string;
  volume: string;
  text: string;
  doc: any;
  version: number;
  status: "draft" | "final";
  summary: string;
  summaryVersion: number;
  updatedAt: string;
}
export interface Fact {
  id: string;
  projectId: string;
  kind: string;
  name: string;
  detail: string;
  aliases: string[];
  planned: boolean;
  locked: boolean;
  chapterId: string | null;
  sourceVersion: number;
  stale: boolean;
}
export interface Run {
  id: string;
  projectId: string;
  status:
    | "running"
    | "paused"
    | "waiting"
    | "failed"
    | "cancelled"
    | "completed";
  stage: string;
  chapterId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  unknownCost: boolean;
  maxRequests: number;
  budget: number | null;
  error: string;
  data: any;
  createdAt: string;
  updatedAt: string;
}
export interface Discussion {
  id: string;
  runId: string;
  chapterId: string;
  role: string;
  model: string;
  content: string;
  createdAt: string;
}
export interface Reference {
  id: string;
  title: string;
  url: string;
  text: string;
  scope: "full" | "excerpt" | "summary";
  evidence: string;
  analyzed: string;
  version: number;
  createdAt: string;
}
export interface Template {
  id: string;
  title: string;
  sourceIds: string[];
  content: string;
  version: number;
  createdAt: string;
}
export interface SearchResult {
  title: string;
  url: string;
  description: string;
  reason: string;
}
export interface Proposal {
  id: string;
  chapterId: string;
  baseVersion: number;
  start: number;
  end: number;
  original: string;
  replacement: string;
  instruction: string;
}
export interface AppEvent {
  type: "changed" | "delta" | "error" | "closing";
  projectId?: string;
  runId?: string;
  chapterId?: string;
  step?: string;
  baseVersion?: number;
  text?: string;
}
export interface Snapshot {
  skillSuggestions: any[];
  skills: Skill[];
  projects: Project[];
  models: ModelConfig[];
  references: Omit<Reference, "text">[];
  templates: Template[];
  searchConfigured: boolean;
  referenceRuns: Run[];
}
export interface ProjectDetail {
  project: Project;
  chapters: Omit<Chapter, "text" | "doc">[];
  facts: Fact[];
  runs: Run[];
  discussions: Discussion[];
  impacts: any[];
}
export interface Bridge {
  call<T = any>(method: string, args?: any): Promise<T>;
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    studio: Bridge;
  }
}
