# Contrato de datos — Luna entera

**Versión 0.1 (borrador) · 2026-11-14**

Este documento fija **cómo se entregan las matrices** para que cada equipo trabaje por
su lado y todo encaje al juntarlo. Es la referencia común: si algo no está aquí, se
añade aquí antes de programarlo.

- Esquema de cada capa: [`docs/schema/layer.schema.json`](schema/layer.schema.json)
- Ejemplo: [`docs/examples/layer.example.json`](examples/layer.example.json)
- Validador: `python tools/validate_layer.py <carpeta_de_la_capa>`

> **Decisiones pendientes**: están marcadas como **D1, D2…** al final. Hasta que se
> cierren, valen las opciones recomendadas.

---

## 1. Idea general

```
            Equipo Global                        Equipo Polar + Web
   ┌─────────────────────────────┐      ┌───────────────────────────────────┐
   │ Matrices de toda la Luna     │      │ Matrices de los polos (más fino)   │
   │ malla G32 (lat/lon, ~1 km)   │      │ mallas PS1K / PN1K (1 km reales)   │
   └──────────────┬──────────────┘      └─────────────────┬─────────────────┘
                  │   mismas reglas: capa = binario + layer.json             │
                  └───────────────────────┬───────────────────────────────────┘
                                          ▼
                         catalog.json (índice de todas las capas)
                                          ▼
              Web: globo 3D (versión reducida de G) + análisis polar detallado
```

- **Una capa = una magnitud física** (luz, pendiente, cobertura…) en una malla concreta.
- Cada capa se entrega como **binario + `layer.json`** con sus metadatos.
- Las capas guardan **valores físicos** (fracción 0–1, horas, grados, km…), **nunca
  puntuaciones**. Lo "bueno" o "malo" lo decide la puntuación de la web, no la capa.

---

## 2. Mallas oficiales

Todas sobre la **esfera de 1737,4 km**, marco **`MOON_ME`** (el de LOLA), latitud
**planetocéntrica**, longitud **positiva hacia el este**.

### 2.1 `G32` — global, equirectangular, 32 píxeles por grado (recomendada, ver D1)

| Campo | Valor |
|---|---|
| Tamaño | **11 520 columnas × 5 760 filas** (66,4 M celdas) |
| Paso | 1/32° = 0,03125° → **0,948 km en el ecuador** |
| Columna `c` (centro) | `lon = -180 + (c + 0.5) / 32` |
| Fila `r` (centro) | `lat =   90 - (r + 0.5) / 32` (fila 0 = norte) |
| Bordes | columna 0 empieza en −180°; fila 0 empieza en +90° |
| Orden | fila a fila, fila 0 arriba (norte), little-endian |

**Por qué 32 px/° y no 10 916 × 5 458:** los productos oficiales de LOLA son de 4, 16,
64 y 128 px/°. Con 32 px/° los bordes de píxel coinciden exactamente con los de la NASA
(LDEM_64 se reduce ×2 sin interpolar). Además, 11 520 y 5 760 se dividen por 2, 3, 4, 5,
6, 8, 9, 10, 12… y eso permite versiones reducidas limpias para la web. 5 458 = 2 × 2 729,
y 2 729 es primo, así que solo se podría reducir ×2.

Versiones reducidas (derivadas, para la web y el globo 3D):

| Id | px/° | Tamaño | Píxel en el ecuador |
|---|---|---|---|
| `G8` | 8 | 2 880 × 1 440 | 3,8 km |
| `G4` | 4 | 1 440 × 720 | 7,6 km |

Reducción = **media de los bloques** (8 → 4: bloques 2 × 2; 32 → 8: 4 × 4), ignorando
`nodata`. Para máscaras (0/1) se guarda la fracción del bloque.

### 2.2 `PS1K` y `PN1K` — polos, estereográfica polar, 1 km real

La proyección equirectangular estropea los polos (a 89°S una columna mide 17 m de ancho).
Por eso cada polo tiene su malla propia, la misma proyección que los productos polares de
LOLA.

| Campo | `PS1K` (sur) | `PN1K` (norte) |
|---|---|---|
| Tamaño | 400 × 400 | 400 × 400 |
| Píxel | 1 000 m | 1 000 m |
| Extensión | x, y ∈ [−200 km, +200 km] | igual |
| Plano | `x = ρ·sin(lon)`, `y = ρ·cos(lon)`, `ρ = 2R·tan(45° + lat/2)` | `x = ρ·sin(lon)`, `y = −ρ·cos(lon)`, `ρ = 2R·tan(45° − lat/2)` |
| Centro de (r, c) | `x = −200 000 + (c + 0.5)·1000`, `y = 200 000 − (r + 0.5)·1000` | igual |
| Cobertura completa | hasta 83,4°S | desde 83,4°N |

`PS1K` es la malla que ya usa la web (`pipeline/moonsite/geo.py`).

### 2.3 Qué malla manda en cada zona

- Para **|lat| ≥ 84°** la referencia es la malla polar (`PS1K` / `PN1K`).
- La malla global **también lleva valor en los polos** (el globo los necesita), remuestreado
  desde la polar cuando exista.
- Comprobación de solape: en 84–86° de latitud, la mediana de |global − polar| debe ser
  pequeña (ver §8).

---

## 3. Formato de una capa

### 3.1 Carpeta

```
layers/
  sun.visible_fraction.mean/
    layer.json
    G32/2026-2030.f32
    G8/2026-2030.u8
    PS1K/2026-2030.f32
  terrain.slope/
    layer.json
    G32/static.f32
    PS1K/static.f32
  catalog.json            ← índice: lista de capas y versiones
```

- Nombre de fichero = **id del periodo** (`static` si no depende del tiempo) + extensión
  del tipo de dato.
- Extensiones: `.f32` (Float32), `.i16` (Int16), `.u16` (UInt16), `.u8` (UInt8).
- Binario **crudo**, little-endian, sin cabecera, fila a fila.
- Opcional: además, una copia **GeoTIFF** para abrir en QGIS. El binario es la referencia.

### 3.2 Sin dato

- En Float32: **NaN**.
- En enteros: el valor de `nodata` del `layer.json` (por convención 255 en `u8`,
  65 535 en `u16`, −32 768 en `i16`).

### 3.3 Cuantización para la web

La web no puede descargar 265 MB por capa (G32 en Float32). Las versiones para la web se
cuantizan:

```
valor_físico = entero × scale + offset
```

`scale` y `offset` van en `layer.json`. Ejemplo: fracción 0–1 en `u8` → `scale = 1/254`,
`offset = 0`, `nodata = 255`.

### 3.4 `layer.json` (resumen; el esquema completo está en `docs/schema/`)

```json
{
  "id": "sun.visible_fraction.mean",
  "version": "0.1.0",
  "title": "Average visible Sun fraction",
  "description": "Time-average of the visible solar disk fraction above the local terrain horizon.",
  "units": "fraction",
  "validRange": [0, 1],
  "kind": "stat",
  "owner": "Equipo Global",
  "fidelity": "computed",
  "method": "Ray-traced horizon over LOLA LDEM_64, 72 azimuths; SPICE DE440, MOON_ME, LT+S; observer 2 m.",
  "params": { "observerHeightM": 2, "sunCriterion": "diskFraction", "samplingHours": 1 },
  "sources": [{ "name": "LOLA LDEM_64", "url": "https://pds-geosciences.wustl.edu/...", "citation": "Smith et al. 2010" }],
  "files": [
    { "grid": "G32", "period": "2026-2030", "path": "G32/2026-2030.f32", "dtype": "float32",
      "sha256": "…", "min": 0, "max": 0.94 }
  ],
  "periods": { "2026-2030": { "start": "2026-01-01T00:00:00Z", "end": "2031-01-01T00:00:00Z" } }
}
```

Campos clave:

- `kind`: `static` (no depende del tiempo), `stat` (estadística de un periodo) o
  `series` (una matriz por intervalo).
- `fidelity`: los niveles del design system (`validated`, `computed`, `approximate`,
  `low`). `validated` solo si hay una comparación publicada en `validation`.
- `files[].sha256`: la huella del fichero. El validador la comprueba.

---

## 4. Tiempo

- Todo en **UTC** (ISO 8601, con `Z`).
- Ephemeris: **SPICE DE440** (`de440s.bsp`), `moon_pa_de440_200625.bpc`,
  `moon_de440_250416.tf`, aberración **`LT+S`**. Sin refracción.
- Periodos estándar (sus ids son los nombres de fichero):

| Id | Desde | Hasta (exclusivo) | Uso |
|---|---|---|---|
| `2026-2030` | 2026-01-01 | 2031-01-01 | Media de largo plazo |
| `2026-01` … `2030-12` | primer día del mes | primer día del mes siguiente | Mensuales (60) |

- Muestreo mínimo para estadísticas de Sol y Tierra: **1 hora**.
- El análisis por misión (fechas a elección del usuario) solo se hace en las mallas
  polares, donde los horizontes caben en la web. Fuera de los polos se usan los
  mensuales.

---

## 5. Definiciones (para que "luz media" signifique lo mismo para todos)

| Término | Definición exacta |
|---|---|
| **Horizonte** | Mayor elevación angular del terreno en cada acimut, vista desde 2 m sobre el suelo, incluida la curvatura de la esfera. Mínimo 72 acimuts (cada 5°). |
| **Sol visible** | Fracción del disco solar por encima del horizonte (0–1), con el radio angular real del Sol. |
| **Tierra visible** | El centro de la Tierra por encima del horizonte (0 o 1), incluida la paralaje. |
| **Fracción media** | Media temporal de lo anterior en el periodo, con muestreo horario. |
| **Noche más larga** | Mayor racha continua con Sol visible < 0,05 dentro del periodo, en horas. |
| **Contacto DSN** | Tierra visible **y** Luna a ≥ 10° sobre el horizonte de Goldstone, Madrid o Canberra. |
| **Cobertura de relevo** | Al menos un satélite de la constelación definida en `params` a ≥ `minElevationDeg` sobre el horizonte local (con relieve). |
| **Sombra permanente** | Celda que nunca recibe Sol directo (producto LOLA LPSR o cálculo propio equivalente). |
| **Pendiente** | Grados respecto a la horizontal; base de cálculo en `params.baselineM`. |

---

## 6. Catálogo de capas que queremos

Prioridad: **P0** = imprescindible para la demo · **P1** = muy recomendable · **P2** = si da tiempo.

### Terreno
| Id | Unidad | Tipo | Fuente oficial | Mallas | Prioridad | Equipo |
|---|---|---|---|---|---|---|
| `terrain.elevation` | m | static | LOLA LDEM_64 (global), LDEM polares | G32, PS1K, PN1K | P0 | Global / Polar |
| `terrain.slope` | ° | static | LOLA LDSM o derivada de LDEM | G32, PS1K, PN1K | P0 | Global / Polar |
| `terrain.roughness` | m | static | LOLA LDRM | G32, PS1K | P2 | Global |
| `terrain.rock_abundance` | fracción | static | LRO Diviner (Bandfield et al. 2011) | G32 | P2 | Recursos |

### Luz
| Id | Unidad | Tipo | Fuente | Mallas | Prioridad | Equipo |
|---|---|---|---|---|---|---|
| `sun.visible_fraction.mean` | fracción | stat | Cálculo (horizontes + SPICE); validar con LOLA AVGVISIB | G32, PS1K, PN1K | P0 | Global / Polar |
| `sun.longest_night_h.max` | h | stat | Cálculo | G32, PS1K, PN1K | P1 | Global / Polar |
| `sun.psr_mask` | fracción | static | LOLA LPSR | G32, PS1K, PN1K | P0 | Polar |
| `sun.horizon` | ° × 72 | static | Cálculo sobre LOLA | PS1K, PN1K | P0 (ya existe en sur) | Polar |

### Comunicaciones
| Id | Unidad | Tipo | Fuente | Mallas | Prioridad | Equipo |
|---|---|---|---|---|---|---|
| `earth.visible_fraction.mean` | fracción | stat | Cálculo (horizontes + SPICE) | G32, PS1K, PN1K | P0 | Global / Polar |
| `earth.dsn_fraction.mean` | fracción | stat | Cálculo + estaciones DSN (DSN 810-005) | G32, PS1K | P1 | Global |
| `relay.coverage_fraction.mean` | fracción | stat | Cálculo con órbitas definidas en `params` | G32, PS1K, PN1K | P1 | Global |
| `relay.max_gap_h` | h | stat | Cálculo | G32, PS1K | P2 | Global |

### Recursos y ciencia
| Id | Unidad | Tipo | Fuente | Mallas | Prioridad | Equipo |
|---|---|---|---|---|---|---|
| `ice.psr_distance_km` | km | static | Derivada de LOLA LPSR | PS1K, PN1K | P0 (ya existe en sur) | Polar |
| `ice.favorability` | índice | static | USGS Ice Favorability Index (Diviner, Siegler et al.) | PS1K | P1 | Recursos |
| `ice.hydrogen_ppm` | ppm | static | Lunar Prospector Neutron Spectrometer (NASA PDS) | G32 | P2 | Recursos |
| `thermal.max_temp_k` / `thermal.min_temp_k` | K | static | LRO Diviner (NASA PDS) | G32, PS1K | P2 | Recursos |
| `science.region_mask` | id | static | Regiones definidas por el equipo (Artemis III, cuenca SPA…) | G32, PS1K | P1 | Polar / Web |

### Puntos (no son matrices)
`sites.geojson`: sitios de referencia (alunizajes de la LROC, Wagner et al. 2017;
regiones Artemis III). GeoJSON con `lon`/`lat` en grados, longitud −180–180 este.

---

## 7. Reparto propuesto

| Equipo | Entrega | Mallas |
|---|---|---|
| **Global** (los compañeros de la matriz) | `sun.*`, `earth.*` y `relay.*` globales; `terrain.*` global | G32 (+ G8 derivada) |
| **Polar + Web** (este repositorio) | Todas las capas polares, `sites.geojson`, puntuación, globo 3D y análisis polar | PS1K, PN1K |
| **Recursos** (si hay alguien libre) | `ice.*`, `thermal.*`, `terrain.rock_abundance` | G32 / PS1K |

Cada entrega debe:
1. pasar `python tools/validate_layer.py layers/<id>`;
2. subirse por pull request a `layers/` (o, si pesa más de 100 MB, adjuntarse como
   *release* de GitHub con el `layer.json` en el repositorio).

---

## 8. Pruebas de aceptación

El validador comprueba automáticamente:

1. **Forma y tipo:** tamaño del fichero = filas × columnas × bytes del tipo.
2. **Huella:** SHA-256 = `files[].sha256`.
3. **Rango:** todos los valores (salvo `nodata`) dentro de `validRange`.
4. **Orientación**, con puntos conocidos. Un mapa girado o reflejado falla aquí:

| Capa | Punto | Esperado |
|---|---|---|
| `terrain.elevation` | Cráter Shackleton, 89,67°S 129,78°E | < −2 000 m (LOLA: −2 786 m) |
| `terrain.elevation` | Mons Mouton, 85,43°S 31,83°E | > +5 000 m (LOLA: +6 395 m) |
| `earth.visible_fraction.mean` | 0°N 0°E (centro de la cara visible) | > 0,95 |
| `earth.visible_fraction.mean` | 0°N 180°E (centro de la cara oculta) | < 0,05 |
| `sun.visible_fraction.mean` (periodo ≥ 1 año) | 0°N 0°E | entre 0,40 y 0,55 |

5. **Solape entre mallas** (cuando la capa existe en G32 y en una polar): mediana de
   |G32 − polar| en 84–86° de latitud ≤ 5 % del rango de la capa.

---

## 9. Decisiones pendientes

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | ¿Malla global 32 px/° (11 520 × 5 760) o la actual 10 916 × 5 458? | **32 px/°**: coincide con LOLA y se reduce limpiamente. Si ya está calculada a 10 916 × 5 458, se remuestrea una vez a G32 al entregarla. |
| **D2** | Longitud de la columna 0: −180° o 0°. | **−180°** (la cara visible queda centrada en la imagen y es lo habitual en SIG). |
| **D3** | Periodo de largo plazo: 2026–2030 (5 años) o el ciclo completo de 18,6 años. | **2026–2030** (coincide con las fechas de misión); validar contra LOLA AVGVISIB (18,6 años) sabiendo que difieren algo. |
| **D4** | Constelación de relevo para `relay.*`. | Definirla en `params` (elementos orbitales y fecha) y documentar la fuente. |
| **D5** | ¿Se calcula también el polo norte (`PN1K`)? | Sí para terreno, luz y Tierra (P1); el análisis de misión, primero en el sur. |

Cambios a este contrato: por pull request, subiendo la versión (0.1 → 0.2) y anotando qué
cambia.
