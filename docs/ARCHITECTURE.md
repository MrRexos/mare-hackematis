# Arquitectura

Web **sin servidor**. La parte pesada se hace una vez en un PC (pipeline de
Python) y genera ficheros pequeños; la web los descarga y hace el cálculo de
cada misión **en el navegador del usuario**. Se puede publicar gratis en
GitHub Pages.

```
                 UNA VEZ, EN UN PC                               EN EL NAVEGADOR
 ┌──────────────────────────────────────────┐        ┌──────────────────────────────────────┐
 │ NASA PDS (LOLA)      NASA/JPL NAIF (SPICE)│        │  Usuario: fechas, duración, pesos     │
 │   relieve, pendiente,  efemérides DE440   │        │                  │                    │
 │   sombra permanente,   orientación Luna   │        │  workers (1 por núcleo)               │
 │   iluminación media                       │        │   Sol y Tierra vs horizonte, hora a   │
 │          │                 │              │        │   hora, para los 160.000 píxeles      │
 │          ▼                 ▼              │        │                  │                    │
 │   pipeline/moonsite (Python, numpy)       │ ─────► │  puntuación + puntos calientes        │
 │   malla 1 km · horizontes · validación    │ ~13 MB │                  │                    │
 │          │                                │        │  mapa de calor + lista de sitios      │
 │          ▼                                │        │  (design system Lunar Horizon)        │
 │   web/public/data/*                       │        └──────────────────────────────────────┘
 └──────────────────────────────────────────┘
```

## Carpetas

| Carpeta | Qué hay |
|---|---|
| `pipeline/moonsite/` | Pipeline de Python. `config.py` reúne todas las hipótesis (fuentes, malla, fechas). |
| `web/` | Web estática: Vite + React 18 (lo exige el design system). |
| `web/public/data/` | Datos generados por el pipeline. Van a git para publicar sin recalcular. |
| `web/public/design-system/` | Design system compartido "Lunar Horizon" (ver `SOURCE.md`). No se edita a mano. |
| `web/src/engine/` | Cálculo: geometría, workers, puntuación, puntos calientes. Sin React. |
| `web/src/components/` | Interfaz: mapa, paneles de misión, prioridades, sitios, Learn. |
| `tools/` | `sync_design_system.py`: trae los cambios del design system compartido. |
| `.cache/` | Descargas de la NASA (~330 MB). Fuera de git. |

## Datos (todos oficiales)

| Capa | Producto | Fuente |
|---|---|---|
| Relieve y horizontes | LOLA `LDEM_75S_240M` | NASA PDS Geosciences Node |
| Pendiente | LOLA `LDSM_75S_240M` | NASA PDS |
| Sombra permanente (indicador de hielo) | LOLA `LPSR_75S_120M` (Mazarico et al. 2011) | NASA PDS |
| Iluminación media del Sol y de la Tierra (validación y capa inicial) | LOLA `AVGVISIB_75S_120M` y `_EARTH` | NASA PDS |
| Rugosidad | LOLA `LDRM_75S_240M` | NASA PDS |
| Temperatura media (2 cm) y máxima, profundidad de estabilidad del hielo | LRO Diviner PRP v2.0 (Paige et al. 2010), MD5 verificado | NASA PDS |
| Sol y Tierra | SPICE: `de440s.bsp`, `moon_pa_de440_200625.bpc`, `moon_de440_250416.tf` | NASA/JPL NAIF |
| Comprobación | Horizons API | NASA/JPL |
| Regiones Artemis III | Anuncio de la NASA (2024-10-28), centros aproximados | NASA |

## Malla

- Estereográfica polar sur, la misma de LOLA. **Píxeles de 1 km × 1 km**, 400 × 400
  (unos 160.000), de −200 a +200 km alrededor del polo: llega a ~83,5°S y cubre
  todas las regiones candidatas de Artemis III publicadas.
- Cada píxel aprovecha datos más finos: horizonte trazado sobre el relieve de 240 m,
  pendiente = mediana de 16 muestras de 240 m, sombra = % del km en sombra (120 m).
- Para cambiar la resolución: `GRID_PX_M` y `GRID_HALF_M` en `config.py`, y volver a
  ejecutar el pipeline.

## Ficheros que genera el pipeline (`web/public/data/`)

| Fichero | Contenido | Tamaño |
|---|---|---|
| `manifest.json` | Malla, capas, unidades, fuentes, metadatos | 5 KB |
| `layers/*.f32` | Capas fijas, Float32, fila 0 arriba | 640 KB c/u |
| `horizon.u8` | Horizonte por píxel, 72 direcciones, 1 byte (0,1°) | 11,5 MB |
| `ephem.f32` | Sol y Tierra (km, MOON_ME), cada hora 2026–2030 | 1 MB |
| `hillshade.png` | Relieve sombreado (ayuda visual, no es luz) | 1,4 MB |
| `validation.json` | Resultados contra Horizons y LOLA | 2 KB |

## Cálculo de una misión (en el navegador)

1. El usuario da la **ventana de aterrizaje** (máx. 60 días) y el **tiempo en superficie**.
2. Para cada píxel y cada hora: elevación y acimut del Sol y de la Tierra en el marco
   local, comparados con el horizonte del terreno en ese acimut.
   - Sol: fracción del disco visible (radio angular real).
   - Tierra: centro sobre el horizonte. Se incluye la paralaje.
3. Se prueban todos los momentos de aterrizaje (cada 3 h) y se queda el mejor por píxel
   según los pesos de Sol y Tierra. Se calcula la noche continua más larga.
4. **Puntuación** (0–100) = 100 · Σ peso × factor / Σ peso, con factores Sol, Tierra,
   terreno suave y cercanía a la sombra permanente. Los **filtros** (pendiente máxima,
   sombra permanente, autonomía de baterías) eliminan píxeles.
5. **Puntos calientes**: grupos conectados del 3 % de píxeles con mejor puntuación,
   ordenados por su mejor píxel.

Cambiar pesos de terreno o hielo, o los filtros, se aplica al momento. Cambiar los pesos
de Sol o Tierra vuelve a lanzar el cálculo, porque cambia el mejor momento de aterrizaje.

## Convenciones científicas (no cambiar sin avisar)

- Marco `MOON_ME` (el de LOLA). Latitud planetocéntrica, longitud positiva al este.
- Direcciones aparentes `LT+S` (como Horizons "airless apparent"). Sin refracción: la
  Luna no tiene atmósfera.
- Fechas en UTC. Observador a 2 m sobre el terreno.
- Plano: `x = rho·sin(lon)`, `y = rho·cos(lon)`; fila 0 arriba (+y, longitud 0°).
- Acimut horario desde el norte (norte = hacia el polo norte = alejándose del polo sur).

Las mismas fórmulas están en `pipeline/moonsite/visibility.py` (Python, para validar) y
en `web/src/engine/` (JavaScript, para la web).

## Límites conocidos

- 1 km y 5° de acimut: sirve para comparar regiones, no para certificar un sitio.
- El relieve a menos de 300 m no se resuelve; rocas y cráteres pequeños no están en los datos.
- La energía es una estimación (fracción del disco solar), no un modelo eléctrico.
- La Tierra visible no garantiza un enlace (no hay balance de enlace).
- "Hielo" = distancia a sombra permanente, no hielo medido.

## Próximos pasos

- Capa de hielo con el Ice Favorability Index (USGS, a partir de Diviner).
- Capa de relevancia científica configurable.
- Más detalle (relieve de 20 o 5 m) solo alrededor de los puntos calientes.
- Ficha de sitio con el gráfico del cielo (SkyPlot) y la TimeBar del design system.
