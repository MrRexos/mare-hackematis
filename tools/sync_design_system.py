"""Sincroniza el design system compartido "Lunar Horizon" con la web.

Fuente de verdad: el artifact compartido por el equipo (no la copia personal):
    https://claude.ai/artifact/6UWwQmPqAZQVqjzMsYRU5Y

El artifact publica `project/tokens.json`, `project/components/bundle.css` y
`project/components/bundle.js`. Este script recibe la carpeta donde se han
descargado esos ficheros y:

1. copia `bundle.css` y `bundle.js` a `web/public/design-system/`;
2. genera `tokens.css` (variables CSS de los dos temas + clases de texto)
   a partir de `tokens.json`, porque el artifact no publica ese fichero;
3. escribe `SOURCE.md` con la versión y los SHA-256, para saber de qué
   versión del design system viene lo que hay en la web.

Uso:
    python tools/sync_design_system.py <carpeta_descargada> [--version <id>]

Cuando el equipo cambie el design system, se vuelve a descargar del artifact
compartido y se ejecuta otra vez. Nunca se editan a mano los ficheros copiados.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "web" / "public" / "design-system"
SOURCE_URL = "https://claude.ai/artifact/6UWwQmPqAZQVqjzMsYRU5Y"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _px(v) -> str:
    """lineHeight puede venir como número (relativo) o como '24px'."""
    return str(v)


def build_tokens_css(tokens: dict) -> str:
    out: list[str] = [
        "/* Generado por tools/sync_design_system.py a partir de tokens.json.",
        f"   Fuente: {SOURCE_URL}. No editar a mano. */",
        "",
    ]

    # --- variables sin tema -------------------------------------------------
    fam = tokens["type"]["families"]
    base = [f"  --font-sans: {fam['sans']};", f"  --font-mono: {fam['mono']};"]
    for group in ("spacing", "radius", "size", "zIndex"):
        for t in tokens[group]["tokens"]:
            base.append(f"  --{t['name']}: {t['value']};")
    out += [":root {", *base, "}", ""]

    # --- variables por tema (color y sombras) --------------------------------
    themed = tokens["color"]["tokens"] + tokens["shadow"]["tokens"]
    for theme in ("dark", "light"):
        sel = ':root, [data-theme="dark"]' if theme == "dark" else '[data-theme="light"]'
        lines = [f"  --{t['name']}: {t['value'][theme]};" for t in themed]
        out += [f"{sel} {{", *lines, "}", ""]

    # --- clases de texto (.title, .readout, .label...) -----------------------
    for group in tokens["type"]["groups"]:
        for s in group["styles"]:
            family = s.get("family", group.get("family", "sans"))
            decl = [
                f"font-family: var(--font-{family})",
                f"font-size: {s['fontSize']}",
                f"line-height: {_px(s['lineHeight'])}",
                f"font-weight: {s['fontWeight']}",
            ]
            if "letterSpacing" in s:
                decl.append(f"letter-spacing: {s['letterSpacing']}")
            out.append(f".{s['name']} {{ {'; '.join(decl)}; }}")
    out.append("")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", type=Path, help="carpeta con project/tokens.json y project/components/")
    ap.add_argument("--version", default="desconocida", help="versión del artifact descargada")
    args = ap.parse_args()

    src = args.src
    tokens_json = src / "project" / "tokens.json"
    comp = src / "project" / "components"
    OUT.mkdir(parents=True, exist_ok=True)

    tokens = json.loads(tokens_json.read_text(encoding="utf-8"))
    (OUT / "tokens.css").write_text(build_tokens_css(tokens), encoding="utf-8")
    for name in ("bundle.css", "bundle.js"):
        shutil.copyfile(comp / name, OUT / name)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    rows = "\n".join(
        f"| `{p}` | `{_sha(src / p)}` |"
        for p in ("project/tokens.json", "project/components/bundle.css", "project/components/bundle.js")
    )
    (OUT / "SOURCE.md").write_text(
        f"""# Design system: Lunar Horizon

These files come from the design system **shared** by the team (not from a copy):
{SOURCE_URL}

- Artifact version: `{args.version}`
- Synced: {now}
- `tokens.css` is generated from `tokens.json`; `bundle.css` and `bundle.js` are copied as they are.

Do not edit them by hand: if the design system changes, sync again with
`python tools/sync_design_system.py <folder>`.

| Source file | SHA-256 |
|---|---|
{rows}
""",
        encoding="utf-8",
    )
    print(f"Design system sincronizado en {OUT}")


if __name__ == "__main__":
    main()
