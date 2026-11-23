import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Store } from "./store";
import { Service } from "./service";
import { importBuffer, exportDocx } from "./documents";
const port = (process as any).parentPort;
let service: Service;
port.on("message", async ({ data }: any) => {
  try {
    let result: any;
    if (data.method === "internal.init") {
      service = new Service(
        new Store(join(data.args.directory, "studio.db")),
        new Map(data.args.keys),
        (event) => port.postMessage({ event }),
      );
      result = true;
    } else if (!service) throw new Error("后台尚未准备好");
    else if (data.method === "internal.shutdown") {
      await service.engine.stopAll();
      service.store.close();
      result = true;
    } else if (data.method === "internal.key") {
      service.keys.set(data.args.id, data.args.key);
      result = true;
    } else if (data.method === "internal.import") {
      result = await importBuffer(
        await readFile(data.args.path),
        extname(data.args.path),
      );
    } else if (data.method === "internal.docx") {
      result = await exportDocx(
        data.args.title,
        data.args.idea,
        data.args.parts,
      );
    } else result = await service.call(data.method, data.args);
    port.postMessage({ id: data.id, result });
  } catch (e) {
    port.postMessage({
      id: data.id,
      error: e instanceof Error ? e.message : "后台操作失败",
    });
  }
});
