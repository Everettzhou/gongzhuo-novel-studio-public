import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  utilityProcess,
  shell,
} from "electron";
import { join, resolve } from "node:path";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { printHTML } from "./documents";
import { modelSchema } from "./service";
let window: BrowserWindow;
let worker: Electron.UtilityProcess;
let stopping = false;
const pending = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: Error) => void }
>();
const directory = process.env.STUDIO_DATA_DIR
  ? resolve(process.env.STUDIO_DATA_DIR)
  : join(process.env.LOCALAPPDATA || app.getPath("appData"), "Gongzhuo");
app.setPath("userData", directory);
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});
const uiURL = pathToFileURL(join(__dirname, "../dist/index.html")).href;
let secrets: Record<string, string> = {};
function rpc(method: string, args: any = {}) {
  return new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, method, args });
  });
}
async function persistSecrets() {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("Windows 密钥加密服务不可用，未保存密钥");
  const encrypted = safeStorage.encryptString(JSON.stringify(secrets));
  await writeFile(join(directory, "credentials.tmp"), encrypted);
  await rename(
    join(directory, "credentials.tmp"),
    join(directory, "credentials.bin"),
  );
}
async function atomicWrite(path: string, data: Buffer | string) {
  const temp = path + "." + randomUUID() + ".tmp";
  await writeFile(temp, data);
  await rename(temp, path);
}
async function exportPDF(snapshot: any, path: string) {
  const result = await PDFDocument.create();
  const batches: any[][] = [];
  let batch: any[] = [];
  let chars = 0;
  for (const part of snapshot.parts) {
    if (chars + part.text.length > 40000 && batch.length) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(part);
    chars += part.text.length;
  }
  if (batch.length) batches.push(batch);
  for (const parts of batches) {
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    try {
      await printWindow.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(printHTML(snapshot.title, parts)),
      );
      const bytes = await printWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        preferCSSPageSize: true,
      });
      const pdf = await PDFDocument.load(bytes);
      for (const page of await result.copyPages(pdf, pdf.getPageIndices()))
        result.addPage(page);
    } finally {
      printWindow.destroy();
    }
  }
  const font = await result.embedFont(StandardFonts.Helvetica);
  result.getPages().forEach((page, index) => {
    const label = `${index + 1} / ${result.getPageCount()}`;
    page.drawText(label, {
      x: (page.getWidth() - font.widthOfTextAtSize(label, 9)) / 2,
      y: 28,
      font,
      size: 9,
    });
  });
  await atomicWrite(path, Buffer.from(await result.save()));
}
app
  .whenReady()
  .then(async () => {
    if (!ownsLock) return;
    await mkdir(directory, { recursive: true });
    try {
      const bytes = await readFile(join(directory, "credentials.bin"));
      if (safeStorage.isEncryptionAvailable())
        secrets = JSON.parse(safeStorage.decryptString(bytes));
    } catch {
      /* Missing keys never prevent offline editing. */
    }
    worker = utilityProcess.fork(join(__dirname, "worker.cjs"), [], {
      serviceName: "共著 · 创作引擎",
    });
    worker.on("message", (message: any) => {
      if (message.event) {
        window?.webContents.send("studio:event", message.event);
        return;
      }
      const call = pending.get(message.id);
      if (call) {
        pending.delete(message.id);
        message.error
          ? call.reject(new Error(message.error))
          : call.resolve(message.result);
      }
    });
    worker.on("exit", () => {
      for (const p of pending.values())
        p.reject(new Error("创作引擎已退出，请重新打开应用；已保存内容仍保留"));
      pending.clear();
      if (!stopping)
        window?.webContents.send("studio:event", {
          type: "error",
          text: "创作引擎已退出，请重新启动应用",
        });
    });
    await rpc("internal.init", { directory, keys: Object.entries(secrets) });
    ipcMain.handle(
      "studio:call",
      async (event, method: string, args: any = {}) => {
        if (
          event.sender !== window.webContents ||
          !event.senderFrame?.url.startsWith(uiURL) ||
          method.startsWith("internal.")
        )
          throw new Error("拒绝非应用窗口请求");
        if (method === "model.save") {
          const config = modelSchema.parse(args);
          const result = await rpc(method, {
            ...config,
            id: config.id || randomUUID(),
          });
          if (config.key) {
            secrets[result.id] = config.key;
            await persistSecrets();
          }
          return result;
        }
        if (method === "model.delete") {
          const result = await rpc(method, args);
          delete secrets[args.id];
          await persistSecrets();
          return result;
        }
        if (method === "secret.brave") {
          if (typeof args.key !== "string" || args.key.length > 4000)
            throw new Error("密钥格式不正确");
          secrets.brave = args.key;
          await persistSecrets();
          await rpc("internal.key", { id: "brave", key: args.key });
          return true;
        }
        if (method === "app.directory") {
          await shell.openPath(directory);
          return directory;
        }
        if (method === "app.close") {
          app.quit();
          return true;
        }
        if (method === "import.preview") {
          const selected = await dialog.showOpenDialog(window, {
            title: "导入小说或参考资料",
            properties: ["openFile"],
            filters: [{ name: "文字文档", extensions: ["txt", "docx"] }],
          });
          if (selected.canceled) return null;
          return {
            name: selected.filePaths[0].split(/[\\/]/).pop(),
            parts: await rpc("internal.import", {
              path: selected.filePaths[0],
            }),
          };
        }
        if (method === "export.save") {
          if (!["docx", "pdf", "txt"].includes(args.format))
            throw new Error("不支持的导出格式");
          const snapshot = await rpc("export.snapshot", {
            projectId: args.projectId,
            chapterIds: args.chapterIds,
            volume: args.volume,
          });
          const selected = await dialog.showSaveDialog(window, {
            title: "导出正式正文",
            defaultPath:
              snapshot.title.replace(/[<>:"/\\|?*]/g, "_") + "." + args.format,
            filters: [
              { name: args.format.toUpperCase(), extensions: [args.format] },
            ],
          });
          if (selected.canceled || !selected.filePath) return null;
          if (args.format === "pdf")
            await exportPDF(snapshot, selected.filePath);
          else if (args.format === "docx")
            await atomicWrite(
              selected.filePath,
              Buffer.from(await rpc("internal.docx", snapshot)),
            );
          else
            await atomicWrite(
              selected.filePath,
              "\ufeff" +
                snapshot.title +
                "\n\n" +
                snapshot.parts
                  .map((x: any) => x.title + "\n\n" + x.text)
                  .join("\n\n"),
            );
          return selected.filePath;
        }
        if (method === "backup.save") {
          const data = await rpc("backup.data");
          const selected = await dialog.showSaveDialog(window, {
            defaultPath: "共著作品备份.json",
            filters: [{ name: "共著备份", extensions: ["json"] }],
          });
          if (selected.canceled || !selected.filePath) return null;
          await atomicWrite(selected.filePath, JSON.stringify(data));
          return selected.filePath;
        }
        if (method === "backup.open") {
          const selected = await dialog.showOpenDialog(window, {
            properties: ["openFile"],
            filters: [{ name: "共著备份", extensions: ["json"] }],
          });
          if (selected.canceled) return null;
          const data = JSON.parse(
            await readFile(selected.filePaths[0], "utf8"),
          );
          return rpc("backup.restore", { bundle: data });
        }
        return rpc(method, args);
      },
    );
    window = new BrowserWindow({
      width: 1480,
      height: 940,
      minWidth: 1050,
      minHeight: 720,
      title: "共著 · 小说工作台",
      backgroundColor: "#f5f4f0",
      show: false,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.setMenu(null);
    window.on("close", (event) => {
      if (!stopping) {
        event.preventDefault();
        window.webContents.send("studio:event", { type: "closing" });
      }
    });
    await window.loadURL(uiURL);
    window.show();
  })
  .catch((error) => {
    dialog.showErrorBox("共著启动失败", String(error?.message || error));
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (stopping || !worker) return;
  event.preventDefault();
  stopping = true;
  Promise.race([
    rpc("internal.shutdown"),
    new Promise((r) => setTimeout(r, 4000)),
  ]).finally(() => {
    worker.kill();
    app.quit();
  });
});
