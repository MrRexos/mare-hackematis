"""Visualizador de una capa del contrato (malla G1K) sobre el relieve de LOLA.

Genera un HTML autónomo (se abre con doble clic, sin servidor) con tres vistas:
- Global (equirectangular, 1440 × 720)
- Polo sur y polo norte (estereográfica polar, hasta --polar-lat grados)

Cada píxel de la vista toma la celda G1K que contiene su centro (la misma fórmula que el
validador), así que lo que se ve es la matriz tal cual, sin suavizar. Encima: relieve
sombreado de LOLA LDEM_64, retícula, puntos de referencia y, al pasar el ratón, latitud,
longitud, fila/columna G1K y valor de la celda.

Uso (desde la raíz del repositorio):
    python tools/view_layer.py layers/sun.visible_fraction.mean
    python tools/view_layer.py layers/sun.visible_fraction.mean --periodo 2026-11-14 --out vista.html

Necesita numpy y pillow. El relieve se lee de .cache/raw/ldem_64.img (`python -m moonsite.fetch
global`); si no está, se usa la capa terrain.elevation G1K si existe, o se dibuja sin relieve.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_layer import grid_shape, load  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
R_M = 1_737_400.0
GW, GH = 1440, 720          # vista global
PN = 900                    # vista polar (píxeles por lado)

#: Puntos de referencia para comprobar a ojo que el mapa no está girado ni desplazado.
REFERENCIAS = [
    ("Shackleton", -89.67, 129.78), ("Mons Mouton", -85.43, 31.83), ("Haworth", -87.45, -5.0),
    ("Cabeus", -85.33, -42.13), ("Peary", 88.63, 33.0), ("Apollo 11", 0.674, 23.473),
    ("Apollo 15", 26.13, 3.63), ("Apollo 17", 20.19, 30.77), ("Tycho", -43.31, -11.36),
    ("Copernicus", 9.62, -20.08), ("Centro cara visible", 0.0, 0.0), ("Centro cara oculta", 0.0, 180.0),
]


# ---------------------------------------------------------------------------
# Geometría de las vistas
# ---------------------------------------------------------------------------
def vista_global():
    lat = 90 - (np.arange(GH) + 0.5) * 180.0 / GH
    lon = -180 + (np.arange(GW) + 0.5) * 360.0 / GW
    LO, LA = np.meshgrid(lon, lat)
    return LA, LO


def vista_polar(sur: bool, lat_lim: float):
    rmax = 2 * R_M * math.tan(math.radians((90 - lat_lim) / 2))
    c = (np.arange(PN) + 0.5) / PN * 2 - 1
    X, Y = np.meshgrid(c * rmax, -c * rmax)       # fila 0 arriba
    rho = np.hypot(X, Y)
    colat = 2 * np.degrees(np.arctan(rho / (2 * R_M)))
    if sur:   # convenio de geo.py: x = rho·sin(lon), y = rho·cos(lon) → 0° arriba
        lat, lon = -90 + colat, np.degrees(np.arctan2(X, Y))
    else:     # polo norte: 0° abajo, 90°E a la derecha
        lat, lon = 90 - colat, np.degrees(np.arctan2(X, -Y))
    return lat, lon, rho <= rmax, rmax


def celda_g1k(lat, lon, rows, cols):
    paso = 360.0 / cols
    c = np.floor(((lon + 180.0) % 360.0) / paso).astype(np.int64) % cols
    r = np.clip(np.floor((90.0 - lat) / paso).astype(np.int64), 0, rows - 1)
    return r, c


# ---------------------------------------------------------------------------
# Relieve
# ---------------------------------------------------------------------------
def cargar_relieve():
    """Función (lat, lon) -> altura en m, o None."""
    img = REPO / ".cache" / "raw" / "ldem_64.img"
    if img.exists():
        sys.path.insert(0, str(REPO / "pipeline"))
        from moonsite.config import LOLA_GLOBAL
        from moonsite.pds import CylRaster
        d = CylRaster.open(img, LOLA_GLOBAL["ldem64"].url)
        raw = d.raw

        def alt(lat, lon):
            n, m = raw.shape
            fi = (d.lat_max - lat) * d.res - 0.5
            fj = ((lon - d.lon_west) % 360.0) * d.res - 0.5
            i0 = np.clip(np.floor(fi).astype(int), 0, n - 2)
            wi = np.clip(fi - i0, 0, 1)
            j0 = np.floor(fj).astype(int) % m
            wj = fj - np.floor(fj)
            j1 = (j0 + 1) % m
            v = (raw[i0, j0] * (1 - wi) * (1 - wj) + raw[i0, j1] * (1 - wi) * wj
                 + raw[i0 + 1, j0] * wi * (1 - wj) + raw[i0 + 1, j1] * wi * wj)
            return v * d.k + d.add
        return alt, "LOLA LDEM_64"
    elev = REPO / "layers" / "terrain.elevation"
    if (elev / "layer.json").exists():
        meta = json.loads((elev / "layer.json").read_text(encoding="utf-8"))
        f = next((f for f in meta["files"] if f["grid"] == "G1K"), None)
        if f:
            a = load(elev, f)
            rows, cols = grid_shape("G1K")
            return (lambda lat, lon: a[celda_g1k(lat, lon, rows, cols)]), "terrain.elevation (G1K)"
    return None, "sin relieve"


def sombreado(z, px_m_x, px_m_y):
    """Relieve sombreado (luz del NO, 45°), 0-255. px_m_*: tamaño del píxel en m."""
    if z is None:
        return None
    z = np.where(np.isfinite(z), z, np.nanmean(z))
    gy, gx = np.gradient(z)
    gx = gx / px_m_x
    gy = -gy / px_m_y
    nx, ny, nz = -gx * 4, -gy * 4, 1.0        # exageración ×4 para que se vea el relieve
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    luz = np.array([-0.5, 0.5, 0.707])
    s = (nx * luz[0] + ny * luz[1] + nz * luz[2]) / n
    return np.clip(60 + 170 * s, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# Imágenes
# ---------------------------------------------------------------------------
def _viridis():
    c = np.array([[0.2777, 0.0054, 0.3340], [0.1050, 1.4046, 1.3845], [-0.3308, 0.2148, 0.0950],
                  [-4.6342, -5.7991, -19.3324], [6.2283, 14.1799, 56.6906], [4.7764, -13.7451, -65.3530],
                  [-5.4355, 4.6459, 26.3124]])
    t = np.linspace(0, 1, 256)[:, None]
    v = sum(c[i] * t ** i for i in range(7))
    return (np.clip(v, 0, 1) * 255).astype(np.uint8)


VIR = _viridis()


def png_b64(arr, mode):
    buf = io.BytesIO()
    Image.fromarray(arr, mode).save(buf, "PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def capa_rgba(v, vmin, vmax, dentro=None):
    ok = np.isfinite(v)
    t = np.clip((np.where(ok, v, vmin) - vmin) / (vmax - vmin), 0, 1)
    rgba = np.zeros(v.shape + (4,), np.uint8)
    rgba[..., :3] = VIR[np.rint(t * 255).astype(int)]
    rgba[..., 3] = 255
    # sin dato: rayado gris (no depende solo del color)
    yy, xx = np.indices(v.shape)
    raya = ((xx + yy) % 8) < 3
    rgba[~ok, :3] = np.where(raya[~ok, None], 150, 70)
    if dentro is not None:
        rgba[~dentro, 3] = 0
    return rgba


def cuantizar(v, vmin, vmax):
    q = np.rint((np.clip(v, vmin, vmax) - vmin) / (vmax - vmin) * 65534)
    return np.where(np.isfinite(v), q, 65535).astype("<u2")


# ---------------------------------------------------------------------------
def generar(layer_dir: Path, periodo: str | None, out: Path | None, polar_lat: float) -> Path:
    meta = json.loads((layer_dir / "layer.json").read_text(encoding="utf-8"))
    files = [f for f in meta["files"] if f["grid"] == "G1K"]
    if not files:
        raise SystemExit("La capa no tiene ningún fichero G1K")
    if periodo:
        f = next((f for f in files if f["period"] == periodo), None)
        if f is None:
            raise SystemExit(f"Periodo '{periodo}' no encontrado. Hay: {', '.join(x['period'] for x in files)}")
    else:
        f = files[-1]
    rows, cols = grid_shape("G1K")
    a = load(layer_dir, f)
    lo, hi = meta["validRange"]
    fin = a[np.isfinite(a)]
    vmin, vmax = (float(fin.min()), float(fin.max())) if fin.size else (lo, hi)
    if vmax <= vmin:
        vmax = vmin + 1e-6
    alt, fuente_rel = cargar_relieve()

    vistas = {}
    LA, LO = vista_global()
    v = a[celda_g1k(LA, LO, rows, cols)]
    z = alt(LA, LO) if alt else None
    hs = sombreado(z, 2 * math.pi * R_M / GW * np.cos(np.radians(LA)).clip(0.05), math.pi * R_M / GH)
    vistas["global"] = {"w": GW, "h": GH, "dato": png_b64(capa_rgba(v, vmin, vmax), "RGBA"),
                        "relieve": png_b64(hs, "L") if hs is not None else None,
                        "q": base64.b64encode(cuantizar(v, vmin, vmax).tobytes()).decode()}
    for nombre, sur in (("sur", True), ("norte", False)):
        la, lon, dentro, rmax = vista_polar(sur, polar_lat)
        v = a[celda_g1k(la, lon, rows, cols)].astype(np.float32)
        v[~dentro] = np.nan
        z = alt(la, lon) if alt else None
        px = 2 * rmax / PN
        hs = sombreado(z, px, px)
        if hs is not None:
            hs = np.dstack([hs, np.where(dentro, 255, 0).astype(np.uint8)])
        vistas[nombre] = {"w": PN, "h": PN, "rmax": rmax, "dato": png_b64(capa_rgba(v, vmin, vmax, dentro), "RGBA"),
                          "relieve": png_b64(hs, "LA") if hs is not None else None,
                          "q": base64.b64encode(cuantizar(v, vmin, vmax).tobytes()).decode()}

    info = {"id": meta["id"], "titulo": meta.get("title", meta["id"]), "unidades": meta.get("units", ""),
            "periodo": f["period"], "rango": [vmin, vmax], "relieve": fuente_rel, "polarLat": polar_lat,
            "fidelidad": meta.get("fidelity", ""), "periodos": [x["period"] for x in files],
            "filas": rows, "cols": cols, "refs": REFERENCIAS, "media": float(fin.mean()) if fin.size else None}
    html = PLANTILLA.replace("/*INFO*/null", json.dumps(info, ensure_ascii=False)) \
                    .replace("/*VISTAS*/null", json.dumps(vistas)) \
                    .replace("/*VIR*/null", json.dumps(VIR.tolist()))
    out = out or layer_dir / f"viewer_{f['period']}.html"
    out.write_text(html, encoding="utf-8")
    return out


PLANTILLA = r"""<!DOCTYPE html>
<html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visor de capa G1K</title>
<style>
body{margin:0;background:#0b1020;color:#f2f4f8;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:12px 18px;border-bottom:1px solid #2c3858;display:flex;gap:18px;flex-wrap:wrap;align-items:baseline}
h1{font-size:18px;margin:0} .muted{color:#b4bdd0;font-size:12px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 18px}
button{background:#0d2a5c;color:#fff;border:1px solid #3d5fa0;border-radius:4px;padding:6px 12px;cursor:pointer;font:inherit}
button[aria-pressed=true]{background:#ffd166;color:#000;border-color:#ffd166;font-weight:600}
.wrap{position:relative;margin:0 18px;display:inline-block;max-width:calc(100vw - 36px)}
.wrap canvas{position:absolute;left:0;top:0;width:100%;height:100%}
.wrap canvas.base{position:relative;display:block}
#tip{position:fixed;pointer-events:none;background:#000e;border:1px solid #fff8;border-radius:6px;padding:8px 10px;font-size:12px;display:none;z-index:5}
#tip b{color:#ffd166}
.leg{display:flex;align-items:center;gap:8px;padding:10px 18px;font-size:12px;color:#b4bdd0;flex-wrap:wrap}
#cbar{width:260px;height:14px;border:1px solid #fff8}
.raya{width:26px;height:14px;border:1px solid #fff8;background:repeating-linear-gradient(45deg,#464646 0 3px,#969696 3px 5px)}
</style></head><body>
<header><h1 id="tit"></h1><span class="muted" id="sub"></span></header>
<div class="bar">
  <button data-v="global" aria-pressed="true">Global</button>
  <button data-v="sur" aria-pressed="false">Pol sud</button>
  <button data-v="norte" aria-pressed="false">Pol nord</button>
  <label class="muted">Opacitat de la capa <input id="op" type="range" min="0" max="100" value="75"></label>
  <label class="muted"><input id="refs" type="checkbox" checked> Punts de referència</label>
  <label class="muted"><input id="ret" type="checkbox" checked> Retícula</label>
</div>
<div class="wrap" id="wrap"><canvas class="base" id="c0"></canvas><canvas id="c1"></canvas><canvas id="c2"></canvas></div>
<div class="leg"><span id="lo"></span><canvas id="cbar" width="256" height="1"></canvas><span id="hi"></span>
<span class="raya"></span><span>sense dada</span><span id="nota"></span></div>
<div id="tip"></div>
<script>
const INFO=/*INFO*/null, VISTAS=/*VISTAS*/null, VIR=/*VIR*/null, R=1737400;
const $=id=>document.getElementById(id);
$('tit').textContent=`${INFO.titulo} (${INFO.id})`;
$('sub').textContent=`Període ${INFO.periodo} · ${INFO.unidades} · malla G1K ${INFO.cols}×${INFO.filas} · relleu: ${INFO.relieve}`+
  (INFO.media!==null?` · mitjana ${fmt(INFO.media)}`:'');
$('lo').textContent=fmt(INFO.rango[0]); $('hi').textContent=fmt(INFO.rango[1])+' '+INFO.unidades;
$('nota').textContent=`Altres períodes disponibles: ${INFO.periodos.join(', ')}`;
{const c=$('cbar').getContext('2d'),im=c.createImageData(256,1);VIR.forEach((v,i)=>im.data.set([...v,255],i*4));c.putImageData(im,0,0);}
function fmt(v){return Math.abs(v)>=100?v.toFixed(0):Math.abs(v)>=10?v.toFixed(1):v.toFixed(3)}
const img=b=>new Promise(r=>{if(!b)return r(null);const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+b});
const dec=b=>{const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return new Uint16Array(u.buffer)};
const cache={};
async function prep(k){if(cache[k])return cache[k];const v=VISTAS[k];
  cache[k]={v,dato:await img(v.dato),rel:await img(v.relieve),q:dec(v.q)};return cache[k];}
let cur='global';
function proj(k,lat,lon){const v=VISTAS[k];
  if(k==='global')return[(lon+180)/360*v.w,(90-lat)/180*v.h];
  const sur=k==='sur'; if(sur?lat>-INFO.polarLat:lat<INFO.polarLat)return null;
  const colat=(90-Math.abs(lat))*Math.PI/180,rho=2*R*Math.tan(colat/2),L=lon*Math.PI/180;
  const x=rho*Math.sin(L),y=sur?rho*Math.cos(L):-rho*Math.cos(L);
  return[(x/v.rmax+1)/2*v.w,(1-y/v.rmax)/2*v.h];}
function inv(k,px,py){const v=VISTAS[k];
  if(k==='global')return{lat:90-(py+0.5)/v.h*180,lon:-180+(px+0.5)/v.w*360};
  const x=((px+0.5)/v.w*2-1)*v.rmax,y=-((py+0.5)/v.h*2-1)*v.rmax,rho=Math.hypot(x,y);
  if(rho>v.rmax)return null;const colat=2*Math.atan(rho/(2*R))*180/Math.PI;
  return k==='sur'?{lat:-90+colat,lon:Math.atan2(x,y)*180/Math.PI}:{lat:90-colat,lon:Math.atan2(x,-y)*180/Math.PI};}
async function draw(){const d=await prep(cur),v=d.v;
  for(const id of['c0','c1','c2']){const c=$(id);c.width=v.w;c.height=v.h;}
  $('wrap').style.width=Math.min(v.w*(cur==='global'?1:0.85),innerWidth-36)+'px';
  const c0=$('c0').getContext('2d');c0.fillStyle='#0b1020';c0.fillRect(0,0,v.w,v.h);if(d.rel)c0.drawImage(d.rel,0,0);
  const c1=$('c1').getContext('2d');c1.globalAlpha=$('op').value/100;c1.drawImage(d.dato,0,0);
  const c2=$('c2').getContext('2d');c2.font='bold 13px system-ui';
  if($('ret').checked){c2.strokeStyle='#ffffff55';c2.lineWidth=1;c2.fillStyle='#fff';
    if(cur==='global'){for(let lo=-150;lo<=150;lo+=30){const[x]=proj(cur,0,lo);c2.beginPath();c2.moveTo(x,0);c2.lineTo(x,v.h);c2.stroke();c2.fillText(lo+'°',x+3,v.h-5);}
      for(let la=-60;la<=60;la+=30){const[,y]=proj(cur,la,0);c2.beginPath();c2.moveTo(0,y);c2.lineTo(v.w,y);c2.stroke();c2.fillText(la+'°',3,y-3);}}
    else{const s=cur==='sur'?-1:1;for(let la=INFO.polarLat;la<90;la+=2.5){const p=proj(cur,s*la,0);if(!p)continue;c2.beginPath();c2.arc(v.w/2,v.h/2,Math.hypot(p[0]-v.w/2,p[1]-v.h/2),0,7);c2.stroke();}
      for(let lo=-180;lo<180;lo+=30){const p=proj(cur,s*INFO.polarLat,lo);c2.beginPath();c2.moveTo(v.w/2,v.h/2);c2.lineTo(p[0],p[1]);c2.stroke();
        const q=proj(cur,s*(INFO.polarLat+0.8),lo);c2.fillText(lo+'°',q[0]-12,q[1]+4);}}}
  if($('refs').checked)for(const[n,la,lo]of INFO.refs){const p=proj(cur,la,lo);if(!p)continue;
    c2.beginPath();c2.arc(p[0],p[1],5,0,7);c2.fillStyle='#fff';c2.fill();c2.lineWidth=2;c2.strokeStyle='#000';c2.stroke();
    c2.lineWidth=3;c2.strokeText(n,p[0]+8,p[1]+4);c2.fillStyle='#fff';c2.fillText(n,p[0]+8,p[1]+4);}}
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{cur=b.dataset.v;
  document.querySelectorAll('[data-v]').forEach(x=>x.setAttribute('aria-pressed',x===b));draw();});
['op','refs','ret'].forEach(id=>$(id).oninput=draw);
$('c2').addEventListener('mousemove',e=>{const d=cache[cur];if(!d)return;const r=e.target.getBoundingClientRect(),v=d.v;
  const px=Math.floor((e.clientX-r.left)/r.width*v.w),py=Math.floor((e.clientY-r.top)/r.height*v.h),ll=inv(cur,px,py),tip=$('tip');
  if(!ll){tip.style.display='none';return;}
  const q=d.q[py*v.w+px],val=q===65535?'sense dada':fmt(INFO.rango[0]+q/65534*(INFO.rango[1]-INFO.rango[0]))+' '+INFO.unidades;
  const st=360/INFO.cols,col=Math.floor((((ll.lon+180)%360)+360)%360/st),fila=Math.min(INFO.filas-1,Math.floor((90-ll.lat)/st));
  tip.innerHTML=`<b>${Math.abs(ll.lat).toFixed(3)}°${ll.lat<0?'S':'N'} ${Math.abs(ll.lon).toFixed(3)}°${ll.lon<0?'W':'E'}</b><br>Cel·la G1K: fila ${fila}, columna ${col}<br>Valor: <b>${val}</b>`;
  tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';});
$('c2').addEventListener('mouseleave',()=>$('tip').style.display='none');
draw();
</script></body></html>"""


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("capa", type=Path, help="carpeta de la capa (layers/<id>)")
    ap.add_argument("--periodo", help="periodo a mostrar (por defecto, el último del layer.json)")
    ap.add_argument("--out", type=Path, help="fichero HTML de salida")
    ap.add_argument("--polar-lat", type=float, default=80.0, help="latitud límite de las vistas polares")
    a = ap.parse_args(argv)
    print(f"Visor: {generar(a.capa, a.periodo, a.out, a.polar_lat)}")


if __name__ == "__main__":
    main()
