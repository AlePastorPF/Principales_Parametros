#!/usr/bin/env python3
"""
Build script for the Índice ERU dashboard (San Isidro Club).

Reads the GPS source workbook + club crest images, computes the Índice ERU
per session, and injects everything into dashboard/template.html to produce
a single self-contained dist/index.html (no external requests at runtime).

Usage:
    python scripts/build_dashboard.py

Requirements: pandas, openpyxl (see requirements.txt)
"""
import base64
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_XLSX = ROOT / "data" / "SIC_Carga.xlsx"
LOGOS_DIR = ROOT / "assets" / "logos"
CREST_MAP_PATH = ROOT / "crest_map.json"
TEMPLATE_PATH = ROOT / "dashboard" / "template.html"
APP_JS_PATH = ROOT / "dashboard" / "app.js"
CHARTJS_PATH = ROOT / "vendor" / "chart.umd.js"
DIST_DIR = ROOT / "dist"
OUTPUT_PATH = DIST_DIR / "index.html"

# ---------------------------------------------------------------------------
# 1. Índice ERU calculation
# ---------------------------------------------------------------------------

POS_GROUP_MAP = {
    "Pilar": "Primera Línea",
    "Hooker": "Primera Línea",
    "Segunda Linea": "Segunda/Tercera Línea",
    "Tercera Linea": "Segunda/Tercera Línea",
    "Medio Scrum": "Medio Scrum",
    "Apertura": "Backs Internos",
    "Centro": "Backs Internos",
    "Wing": "Backs Externos",
    "Fullback": "Backs Externos",
}

WEIGHTS = {
    "Primera Línea":         dict(dur=0.10, de=0.20, rhie=0.20, big=0.25, con=0.25),
    "Segunda/Tercera Línea": dict(dur=0.10, de=0.20, rhie=0.15, big=0.25, con=0.30),
    "Medio Scrum":           dict(dur=0.20, de=0.20, rhie=0.25, big=0.15, con=0.10),
    "Backs Internos":        dict(dur=0.20, de=0.25, rhie=0.25, big=0.15, con=0.15),
    "Backs Externos":        dict(dur=0.20, de=0.35, rhie=0.25, big=0.10, con=0.10),
}
METRICS = ["dur", "de", "rhie", "big", "con"]
POSGROUPS = list(WEIGHTS.keys())

RIVAL_MAP = {
    "Alumni": "Alumni", "BA": "BA", "BAC": "BAC", "CASI": "CASI", "CRBV": "CRBV",
    "CUBA": "CUBA", "Champagnat": "Champagnat", "Hindu": "Hindu", "LMRC": "LMRC",
    "LPRC": "LPRC", "Los Tilos": "LosTilos", "Newman": "Newman", "Plaza": "Plaza",
    "San Luis": "SanLuis",
}


def normalize(val, mn, mx, inverse=False):
    if mx == mn:
        return 0.0
    n = (val - mn) / (mx - mn)
    return (1 - n) if inverse else n


def extract_rival(actividad, etiqueta):
    if etiqueta != "Partido":
        return None
    m = re.match(r"SIC vs (.+)", actividad)
    if not m:
        return None
    rest = m.group(1)
    rest = re.sub(r"\s*\([^)]*\)", "", rest)          # quita (Int)/(Semi)/(Final)
    rest = re.sub(r"\s+(PO|Semi|Final|\d+)$", "", rest)  # quita sufijos PO/Semi/Final/número
    return RIVAL_MAP.get(rest.strip(), rest.strip())


def load_and_process_data():
    df = pd.read_excel(DATA_XLSX, sheet_name="GPS")
    sess = df[df["Periodo"] == "Session"].copy()
    sess = sess.dropna(subset=["Duracion (min)"])          # 1 fila sin duración
    sess = sess[sess["Puesto"].str.strip() != ""]          # 1 fila con Puesto en blanco

    sess = sess.rename(columns={
        "Duracion (min)": "dur", "Dist Exp": "de", "RHIE Total Bouts": "rhie",
        " # BiG ": "big", "Contactos": "con", "Etiqueta de Actividad": "etiqueta",
        "Temporada": "temporada", "Puesto": "puesto", "Jugador": "jugador",
        "Actividad": "actividad", "Fecha": "fecha",
    })
    sess["posGroup"] = sess["puesto"].map(POS_GROUP_MAP)
    assert sess["posGroup"].isna().sum() == 0, "Puesto sin grupo posicional mapeado"

    # normalización min-max por temporada (todos los puestos/actividades de esa temporada)
    season_ranges = {}
    for temp, g in sess.groupby("temporada"):
        season_ranges[int(temp)] = {m: (float(g[m].min()), float(g[m].max())) for m in METRICS}

    eru_units, contribs = [], {m: [] for m in METRICS}
    for _, row in sess.iterrows():
        temp = int(row["temporada"])
        rng = season_ranges[temp]
        w = WEIGHTS[row["posGroup"]]
        n = {m: normalize(row[m], *rng[m], inverse=(m == "big")) for m in METRICS}
        c = {m: w[m] * n[m] * 100 for m in METRICS}
        for m in METRICS:
            contribs[m].append(c[m])
        eru_units.append(sum(c.values()))

    sess["eruUnits"] = eru_units
    for m in METRICS:
        sess[f"c_{m}"] = contribs[m]
    sess["rival"] = sess.apply(lambda r: extract_rival(r["actividad"], r["etiqueta"]), axis=1)

    # % máx = máximo individual del propio jugador entre sus PARTIDOS de esa temporada
    # (si no jugó partidos esa temporada, se usa su mejor registro de cualquier tipo)
    partido_max = sess[sess["etiqueta"] == "Partido"].groupby(["jugador", "temporada"])["eruUnits"].max()
    any_max = sess.groupby(["jugador", "temporada"])["eruUnits"].max()

    def pct_ref(jugador, temporada):
        key = (jugador, temporada)
        return partido_max.loc[key] if key in partido_max.index else any_max.loc[key]

    sess["pctRef"] = sess.apply(lambda r: pct_ref(r["jugador"], r["temporada"]), axis=1)
    sess["eruPct"] = sess["eruUnits"] / sess["pctRef"] * 100

    season_max_eru = sess.groupby("temporada")["eruUnits"].max().to_dict()

    players = sorted(sess["jugador"].unique().tolist())
    p_idx = {p: i for i, p in enumerate(players)}
    puestos = sorted(sess["puesto"].unique().tolist())
    pu_idx = {p: i for i, p in enumerate(puestos)}
    pg_idx = {p: i for i, p in enumerate(POSGROUPS)}
    temporadas = sorted(int(t) for t in sess["temporada"].unique())

    rows = []
    for _, r in sess.iterrows():
        rows.append([
            p_idx[r["jugador"]], pu_idx[r["puesto"]], pg_idx[r["posGroup"]],
            1 if r["etiqueta"] == "Partido" else 0,
            r["rival"] if pd.notna(r["rival"]) else None,
            int(r["temporada"]), r["fecha"].strftime("%Y-%m-%d"),
            round(float(r["dur"]), 1), round(float(r["de"]), 1), round(float(r["rhie"]), 1),
            round(float(r["big"]), 2), int(r["con"]),
            round(float(r["eruUnits"]), 2), round(float(r["eruPct"]), 1),
            r["actividad"],
            round(float(r["c_dur"]), 2), round(float(r["c_de"]), 2), round(float(r["c_rhie"]), 2),
            round(float(r["c_big"]), 2), round(float(r["c_con"]), 2),
        ])

    data = {
        "players": players,
        "puestos": puestos,
        "posgroups": POSGROUPS,
        "temporadas": temporadas,
        "seasonRanges": {
            int(k): {m: [round(v[0], 2), round(v[1], 2)] for m, v in vv.items()}
            for k, vv in season_ranges.items()
        },
        "seasonMaxEru": {int(k): round(float(v), 2) for k, v in season_max_eru.items()},
        "weights": WEIGHTS,
        "colFields": [
            "playerIdx", "puestoIdx", "posGroupIdx", "isMatch", "rival", "temporada", "fecha",
            "dur", "de", "rhie", "big", "con", "eruUnits", "eruPct", "actividad",
            "c_dur", "c_de", "c_rhie", "c_big", "c_con",
        ],
        "rows": rows,
    }
    return data


# ---------------------------------------------------------------------------
# 2. Logos -> base64
# ---------------------------------------------------------------------------

def build_logos_json():
    crest_map = json.loads(CREST_MAP_PATH.read_text(encoding="utf-8"))
    out = {}
    for code, fname in crest_map.items():
        if code.startswith("_"):
            continue
        path = LOGOS_DIR / fname
        ext = path.suffix.lower().lstrip(".")
        mime = "image/png" if ext == "png" else "image/jpeg"
        b64 = base64.b64encode(path.read_bytes()).decode()
        out[code] = f"data:{mime};base64,{b64}"
    return out


# ---------------------------------------------------------------------------
# 3. Inject into template
# ---------------------------------------------------------------------------

def main():
    print("1/4 · Procesando SIC_Carga.xlsx y calculando Índice ERU…")
    data = load_and_process_data()
    print(f"     {len(data['rows'])} registros · {len(data['players'])} jugadores · "
          f"temporadas {data['temporadas']}")

    print("2/4 · Codificando escudos en base64…")
    logos = build_logos_json()
    print(f"     {len(logos)} escudos")

    print("3/4 · Inyectando datos en la plantilla…")
    html = TEMPLATE_PATH.read_text(encoding="utf-8")
    chartjs = CHARTJS_PATH.read_text(encoding="utf-8")
    app_js = APP_JS_PATH.read_text(encoding="utf-8")
    data_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    logos_json = json.dumps(logos, ensure_ascii=False, separators=(",", ":"))

    for placeholder, content in [
        ("/*__CHARTJS__*/", chartjs),
        ("/*__DATA_JSON__*/", data_json),
        ("/*__LOGOS_JSON__*/", logos_json),
        ("/*__APP_JS__*/", app_js),
    ]:
        if placeholder not in html:
            raise RuntimeError(f"Placeholder {placeholder} no encontrado en template.html")
        html = html.replace(placeholder, content)

    assert "__CHARTJS__" not in html and "__DATA_JSON__" not in html, "Quedó un placeholder sin reemplazar"
    json.loads(data_json)   # valida integridad
    json.loads(logos_json)  # valida integridad

    DIST_DIR.mkdir(exist_ok=True)
    OUTPUT_PATH.write_text(html, encoding="utf-8")
    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"4/4 · Listo → {OUTPUT_PATH} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
