# NASA Space Apps 2026 — Lunar Landing Site Navigator

Selector de misiones al polo sur lunar: introduces la **ventana de aterrizaje** y la
**duración** de la misión, y la web calcula un **mapa de calor de viabilidad** con
datos oficiales de la NASA. El mapa combina exposición solar, visibilidad de la Tierra,
relieve y cercanía al hielo, y marca los **puntos calientes** donde mejor aterrizar.

Reto: [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

- **Datos:** NASA LOLA (PDS) y NASA/JPL SPICE, validados contra JPL Horizons.
- **Malla:** 1 km × 1 km, 83,5–90°S.
- **Sin servidor:** web estática; el cálculo se hace en el navegador.
- **Diseño:** design system compartido "Lunar Horizon".

- **Arquitectura completa:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Contrato de datos** para ampliar a la Luna entera y repartir el trabajo entre equipos:
  [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md).
- **Validar una capa antes de entregarla:**

  ```bash
  python tools/validate_layer.py layers/<id>
  ```

## Arrancar la web (solo ver)

Los datos ya generados están en `web/public/data/`. Necesitas Node 18 o superior.

```bash
cd web
npm install
npm run dev
```

Abre http://localhost:5173.

## Astronaut Mode

En **Mare → Lander's View**, pulsa el casco **Astronaut Mode** para caminar por una región de 1 km × 1 km alrededor del punto seleccionado. Incluye terreno NASA real a escala 1:1, física lunar, Sol/Tierra según SPICE, controles temporales, cuatro superficies y 13 variantes de roca Quixel, agrupadas en campos de fragmentos.

Controles: WASD, ratón capturado, Shift, Espacio y R. Escape pausa y abre los ajustes; Resume exploring vuelve a capturar el ratón. Los datos de demo y el fallback regional están incluidos. Consulta [ejecución, fuentes, preparación de DEM, assets, pruebas y límites científicos](docs/ASTRONAUT_MODE.md).

## Regenerar los datos (pipeline)

Necesitas Python 3.11 o superior. La descarga ocupa unos 330 MB en `.cache/`, fuera de git.

```bash
python -m venv .venv
.venv/Scripts/pip install -r pipeline/requirements.txt
cd pipeline
../.venv/Scripts/python -m moonsite.fetch
../.venv/Scripts/python -m moonsite.build all
```

`build all` ejecuta, en orden:
- capas fijas;
- efemérides;
- horizontes (unos minutos);
- sitios;
- validación (necesita red para JPL Horizons).

## Design system

Los ficheros de `web/public/design-system/` vienen del design system **compartido** del
equipo, no de una copia. Si el equipo lo cambia, se descarga de nuevo y se ejecuta:

```bash
python tools/sync_design_system.py <carpeta_descargada> --version <id>
```
