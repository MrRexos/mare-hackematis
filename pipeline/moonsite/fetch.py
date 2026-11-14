"""Descarga los productos LOLA (PDS) y los kernels SPICE (NAIF) a .cache/.

Los servidores de PDS y NAIF limitan la velocidad de cada conexión, así que
los ficheros grandes se bajan en trozos en paralelo (peticiones HTTP Range)
sobre un fichero `.part` que solo se renombra cuando está completo.
Si se corta, al volver a ejecutar se empieza de nuevo ese fichero; los ya
completos se saltan.

Uso:
    python -m moonsite.fetch            # todo lo necesario
    python -m moonsite.fetch extra      # + visibilidad media de la Tierra
    python -m moonsite.fetch global     # + relieve global LDEM_64 (trabajo T4, 531 MB)
    python -m moonsite.fetch thermal    # temperaturas Diviner de toda la Luna (2,8 GB)
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from .config import DIVINER, DIVINER_GCP, LOLA, LOLA_EXTRA, LOLA_GLOBAL, SPICE, Remote

CHUNK = 4 << 20  # 4 MiB por petición
WORKERS = 16


def _size(url: str) -> int | None:
    r = requests.head(url, allow_redirects=True, timeout=60)
    r.raise_for_status()
    n = r.headers.get("Content-Length")
    return int(n) if n else None


def _get_range(url: str, path, start: int, end: int) -> None:
    for attempt in range(1, 7):
        try:
            r = requests.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=180)
            if r.status_code != 206 or len(r.content) != end - start + 1:
                raise requests.RequestException(f"respuesta {r.status_code}, {len(r.content)} B")
            with open(path, "r+b") as fh:
                fh.seek(start)
                fh.write(r.content)
            return
        except requests.RequestException as e:
            if attempt == 6:
                raise
            print(f"   reintento {attempt} [{start}-{end}]: {e}", flush=True)
            time.sleep(2 * attempt)


def download(f: Remote) -> None:
    f.dest.parent.mkdir(parents=True, exist_ok=True)
    if f.dest.exists() and (f.size is None or f.dest.stat().st_size == f.size):
        print(f"[ok]   {f.dest.name}")
        return
    size = _size(f.url)
    if f.size is not None and size is not None and size != f.size:
        raise RuntimeError(f"{f.url}: el servidor dice {size} B y esperábamos {f.size} B")
    part = f.dest.with_name(f.dest.name + ".part")
    t0 = time.time()
    if size is None or size < CHUNK:
        r = requests.get(f.url, timeout=300)
        r.raise_for_status()
        part.write_bytes(r.content)
    else:
        with open(part, "wb") as fh:
            fh.truncate(size)
        starts = list(range(0, size, CHUNK))
        print(f"[get]  {f.dest.name}: {size / 1e6:.1f} MB en {len(starts)} trozos", flush=True)
        with ThreadPoolExecutor(WORKERS) as pool:
            futs = [pool.submit(_get_range, f.url, part, s, min(s + CHUNK, size) - 1) for s in starts]
            for i, fut in enumerate(as_completed(futs), 1):
                fut.result()
                if i % 5 == 0 or i == len(futs):
                    print(f"       {i}/{len(futs)}", flush=True)
    if f.size is not None and part.stat().st_size != f.size:
        raise RuntimeError(f"{f.dest.name}: tamaño incorrecto tras la descarga")
    part.replace(f.dest)
    print(f"[hecho] {f.dest.name} en {time.time() - t0:.0f} s", flush=True)


def main(argv: list[str]) -> None:
    files = {**SPICE, **LOLA, **DIVINER}
    if "extra" in argv:
        files |= LOLA_EXTRA
    if "global" in argv:
        files = {**SPICE, **LOLA_GLOBAL}
    if "thermal" in argv:
        files = dict(DIVINER_GCP)
    for f in files.values():
        download(f)


if __name__ == "__main__":
    main(sys.argv[1:])
