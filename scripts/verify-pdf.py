"""Read-only PDF validation: text completeness and visual sample renders."""
from pathlib import Path
import json
import re
import pypdfium2 as pdfium

out = Path(__file__).resolve().parents[1] / "artifacts"
reports = []
for filename in ["验收模拟小说.pdf", "百万字容量验证.pdf", "Word渲染样稿.pdf"]:
    pdf = pdfium.PdfDocument(out / filename)
    text = ""
    for page in pdf:
        tp = page.get_textpage()
        text += tp.get_text_range()
        tp.close()
        page.close()
    compact = re.sub(r"\s", "", text)
    if filename.startswith("百万"):
        for i in range(1, 401):
            assert f"独立检索标记{i:04d}" in compact, f"Missing chapter {i} opening"
            assert f"末尾完整性标记{i:04d}" in compact, f"Missing chapter {i} ending"
    else:
        assert "沈砚" in compact
        assert compact.count("信纸边缘") >= 100
    for index in sorted({0, 1, len(pdf) // 2, len(pdf) - 1}):
        page = pdf[index]
        bitmap = page.render(scale=1.4)
        bitmap.to_pil().save(out / f"{Path(filename).stem}-page-{index+1}.png")
        page.close()
    reports.append({"file": filename, "pages": len(pdf), "extractedCharacters": len(compact), "allChapterMarkersPresent": True})
    pdf.close()
(out / "pdf-validation.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps(reports, ensure_ascii=False, indent=2))
