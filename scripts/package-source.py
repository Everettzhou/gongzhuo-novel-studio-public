"""Package only application source and verification documentation."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / "release" / "Gongzhuo-Source-0.2.0.zip"
entries = ["src", "electron", "tests", "scripts", "build", "docs", ".gitignore", "README.md", "PRODUCT.md", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "playwright.config.ts", "index.html"]
with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
    for entry in entries:
        path = root / entry
        paths = path.rglob("*") if path.is_dir() else [path]
        for file in paths:
            if file.is_file() and "__pycache__" not in file.parts:
                archive.write(file, file.relative_to(root).as_posix())
with zipfile.ZipFile(target) as archive:
    assert archive.testzip() is None
    assert "electron/engine.ts" in archive.namelist()
    assert "docs/验证报告.md" in archive.namelist()
    print(f"{target}: {len(archive.namelist())} files, {target.stat().st_size} bytes")
