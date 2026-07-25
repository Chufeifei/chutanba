from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
mini = root / "miniprogram"

errors = []

for path in root.rglob("*.json"):
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        errors.append(f"JSON error: {path.relative_to(root)}: {exc}")

app = json.loads((mini / "app.json").read_text(encoding="utf-8"))
for page in app["pages"]:
    base = mini / page
    for ext in [".js", ".json", ".wxml", ".wxss"]:
        path = Path(str(base) + ext)
        if not path.exists():
            errors.append(f"Missing page file: {path.relative_to(root)}")

if errors:
    print("\n".join(errors))
    raise SystemExit(1)

print("Project structure and JSON files look valid.")
