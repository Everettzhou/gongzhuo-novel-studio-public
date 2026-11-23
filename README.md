# 共著 · 多 AI 协同小说创作工作台

基于 Electron、React 和 TypeScript 的中文 Windows 桌面应用。将策划、主笔与 1～2 个审稿角色组织为可暂停、可恢复的创作流程，支持长篇连载和短篇小说。

## 功能

- 多模型接入：OpenAI 兼容协议、Gemini 和 Anthropic 原生协议，角色可独立配置。
- 创作流程：大纲、分场景写作、审稿协商、修订与章节摘要维护。
- 长篇记忆：人物设定、别名、时间线、伏笔与 SQLite 全文检索。
- Skills：导入 Markdown 指令并按角色启用；根据写作记录生成更新建议，经用户采纳后保存新版本，不训练模型权重。
- 编辑与文档：流式显示、选区改写、版本管理，支持 DOCX / PDF / TXT 导出。
- 本地数据：SQLite 存储，API 密钥通过 Electron safeStorage 加密。

## 开发启动

环境：Windows x64，Node.js 22.13+，npm。

```powershell
npm ci
node node_modules/electron/install.js
npm run dev
```

启动后在「模型与设置」配置模型地址、模型 ID 和自己的 API 密钥，再在作品「创作配置」绑定各角色。

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run package
```

安装包由打包命令生成在 `release/`，不包含在源码仓库中。本源码版本为 0.2.0。

## 目录结构

```text
src/          React 工作台、编辑器与共享类型
electron/     Electron 入口、后台调度、存储及模型适配
  engine.ts   创作、审稿、重试及恢复流程
  providers.ts 统一模型调用接口及协议适配
  service.ts  业务操作与输入校验
  store.ts    SQLite、版本及全文检索
tests/        核心测试与桌面端到端测试
scripts/      构建、打包及验证脚本
docs/         使用说明、截图与历史验证报告
build/        应用图标
```

## 文档

- [使用说明](docs/使用说明.md)
- [Skills 导入与复盘更新](docs/Skills使用说明.md)
- [产品设计](PRODUCT.md)
- [历史验证报告](docs/验证报告.md)

历史验证记录包含 38 项单元测试、3 项桌面测试和约 400 章、百万字容量测试；这些是当时结果，不代表本次重新运行。模型自动化测试使用模拟 API，不代表商业模型写作质量。

## 数据与费用

默认数据位于 `%LOCALAPPDATA%\Gongzhuo`，项目备份不包含 API 密钥。离线可编辑及导出；在线生成会把所需正文、设定和已启用 Skills 发送给用户配置的模型服务。搜索使用独立 Brave Search 密钥。费用以服务商账单为准。

## 公开版本

此仓库包含共著 0.2.0 的源码、测试和文档，不包含 ZIP、安装包或本机验证原始记录。
