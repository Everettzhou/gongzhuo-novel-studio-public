import mammoth from "mammoth";
import { JSDOM } from "jsdom";
import iconv from "iconv-lite";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Footer,
  PageNumber,
  AlignmentType,
} from "docx";
export interface ImportPart {
  title: string;
  text: string;
}
export function splitChapters(text: string): ImportPart[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const result: ImportPart[] = [];
  let title = "导入正文";
  let body: string[] = [];
  for (const line of lines) {
    if (
      /^(?:第[〇零一二三四五六七八九十百千万\d]+[章节卷回部][\s　:：.、]?.{0,60}|#{1,3}\s+.{1,60})$/.test(
        line.trim(),
      )
    ) {
      if (body.join("").trim())
        result.push({ title, text: body.join("\n").trim() });
      title = line.trim().replace(/^#+\s*/, "");
      body = [];
    } else body.push(line);
  }
  if (body.join("").trim())
    result.push({ title, text: body.join("\n").trim() });
  return result;
}
export async function importBuffer(
  buffer: Buffer,
  extension: string,
): Promise<ImportPart[]> {
  if (buffer.length > 30 * 1024 * 1024)
    throw new Error("文件超过 30 MB，请按卷拆分导入");
  let text = "";
  if (extension.toLowerCase() === ".docx") {
    const result = await mammoth.convertToHtml(
      { buffer },
      { includeDefaultStyleMap: true },
    );
    const dom = new JSDOM(result.value);
    text = Array.from(dom.window.document.body.children)
      .map(
        (el) =>
          `${/^H[1-6]$/.test(el.tagName) ? "# " : ""}${el.textContent || ""}`,
      )
      .join("\n\n");
    dom.window.close();
  } else if (extension.toLowerCase() === ".txt") {
    if (buffer[0] === 0xff && buffer[1] === 0xfe)
      text = iconv.decode(buffer, "utf16-le");
    else if (buffer[0] === 0xfe && buffer[1] === 0xff)
      text = iconv.decode(buffer, "utf16-be");
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        text = iconv.decode(buffer, "gb18030");
      }
    }
  } else throw new Error("只支持 TXT 和 DOCX");
  const parts = splitChapters(text);
  if (!parts.length) throw new Error("文件中没有可导入的文字");
  return parts;
}
export async function exportDocx(
  title: string,
  idea: string,
  parts: ImportPart[],
) {
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ text: idea }),
  ];
  for (const part of parts) {
    children.push(
      new Paragraph({
        text: part.title,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
      }),
    );
    for (const line of part.text.split("\n").filter((line) => line.trim()))
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, font: "宋体", size: 24 })],
          spacing: { after: 100, line: 360 },
          indent: { firstLine: 480 },
        }),
      );
  }
  return Packer.toBuffer(
    new Document({
      creator: "共著",
      title,
      styles: { default: { document: { run: { font: "宋体", size: 24 } } } },
      sections: [
        {
          properties: {},
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ children: [PageNumber.CURRENT] })],
                }),
              ],
            }),
          },
          children,
        },
      ],
    }),
  );
}
export const escapeHTML = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function printHTML(title: string, parts: ImportPart[]) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4;margin:22mm 20mm}body{font-family:'SimSun','Microsoft YaHei',serif;font-size:12pt;line-height:1.9;color:#111}h1{font-size:22pt}h2{font-size:17pt;break-before:page}h2:first-of-type{break-before:auto}p{margin:0 0 6pt;text-indent:2em;white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}</style><h1>${escapeHTML(title)}</h1>${parts
    .map(
      (p) =>
        `<h2>${escapeHTML(p.title)}</h2>${p.text
          .split("\n")
          .filter((line) => line.trim())
          .map((l) => `<p>${escapeHTML(l) || "&nbsp;"}</p>`)
          .join("")}`,
    )
    .join("")}</html>`;
}
