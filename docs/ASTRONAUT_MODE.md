# Astronaut Mode

Modo integrado en **Mare → Lander's View → casco Astronaut Mode**. Utiliza las coordenadas seleccionadas y el reloj UTC compartido. La reproducción del reloj del mapa se detiene al entrar para que solo controle el tiempo el panel de Astronaut Mode. **Exit** vuelve a la ficha; conserva el punto y la fecha, incluidos los cambios temporales hechos dentro del modo.

## Ejecutar

```powershell
cd web
npm install
npm run dev
```

Los datos necesarios están incluidos en `web/public/data/astronaut/`: no hay que ejecutar Python para explorar las regiones preparadas o el DEM regional. El código de física y renderizado se carga cuando se pulsa el casco.

Controles: **Start exploring**, WASD o flechas para caminar, ratón para mirar, Shift para desplazarse más rápido, Espacio para saltar, R para volver al centro. **Escape libera el ratón, pausa y abre directamente la fecha y hora**. El menú permite alternar entre **Date & time**, **Settings** y **Sources**; **Resume exploring**, disponible en los tres paneles, vuelve a capturar el ratón mediante un gesto del usuario. El ratón desaparece durante la exploración. El escritorio usa exclusivamente deltas relativos con Pointer Lock, sin arrastre por coordenadas de pantalla; se descarta el primer evento de captura y los saltos espurios del controlador. La pérdida de foco también pausa. Si el navegador rechaza la captura, permanece en pausa y ofrece reintentarlo. Requiere `localhost` o HTTPS. En pantalla táctil se arrastra la vista y se usan los botones de movimiento.

El panel de calendario cambia fecha/hora UTC y ofrece un avance temporal de 6 horas reales por segundo. **Find sunlight** busca una hora con el disco solar visible desde la posición actual dentro del periodo de misión; cambia la fecha únicamente al pulsarlo y avisa si no encuentra luz. Una elevación solar positiva no implica visibilidad si hay relieve delante. No se simula un día terrestre. Ajustes: LOW, MEDIUM, HIGH, ULTRA, campo de visión, sensibilidad, densidad visual de grava y minimapa. El casco dispone de una luz artificial identificada y desactivable; permite explorar lugares sin luz solar.

## Datos científicos incluidos

| Producto | Uso | Espaciado | Fuente |
| --- | --- | --- | --- |
| LOLA Site01, Connecting ridge | Demo en −89.45°, 222.5°E; recorte de 2.2 km para escoger una región explorable de 1 km | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LOLA Haworth | Recorte de 2.2 km en −86.86°, 338.14°E | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LDEM_75S_240M | Cobertura regional para cualquier punto del mapa y terreno contextual hasta 16 km | 240 m | [NASA PDS LOLA](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.lbl) |
| Catálogo PGDA de DEM de 5 m y LDEM_83S_10MPP_ADJ | Selección por cobertura y resolución en desarrollo | 5 / 10 m | [PGDA 78](https://pgda.gsfc.nasa.gov/products/78), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) |

`catalog.json` registra producto, URL, proveedor, cobertura, proyección, marco, datum vertical, resolución y limitaciones de incertidumbre. Cada recorte incluye SHA-256 y fracción válida; los recortes incluidos tienen todos sus valores válidos. Los DEM LOLA de 5 m contienen interpolación entre medidas; **5 m de espaciado no significa 5 m de resolución efectiva ni precisión de altura**. La incertidumbre por muestra no está incluida; se enlazan los productos originales con sus mapas de error.

Las alturas se obtienen del raster científico por interpolación bilineal. La malla mide exactamente **1,000 × 1,000 unidades**, con una unidad por metro, e incorpora la curvatura lunar. No hay exageración vertical ni desplazamiento procedural de vértices. Cuando se interpola el DEM de 240 m sobre una malla más densa, la interfaz sigue mostrando **240 m**.

Se rechaza una región con NoData o cobertura incompleta; se intenta la siguiente fuente compatible. No se sustituyen huecos por ruido ni elevaciones inventadas. El worker evita bloquear la interfaz. La caché de tres terrenos conserva coordenadas, versión del catálogo, fuentes, resoluciones y hashes; reutiliza el resultado al volver a abrirlo y se invalida al cambiar los datos.

### Carga online y publicación estática

NASA PGDA no expone CORS para estos GeoTIFF. En `npm run dev`, Vite actúa como proxy únicamente hacia `pgda.gsfc.nasa.gov/data/`; GeoTIFF.js lee ventanas mediante HTTP Range dentro del worker. Escoge el DEM compatible con menor espaciado real, incluidos los de 5 m. No descarga un GeoTIFF de varios GB completo. Si falla, utiliza el siguiente producto y finalmente el DEM local de 240 m.

En `npm run build`, se utilizan los **recortes empaquetados y el DEM regional local**. El proxy de desarrollo no existe en la publicación estática. Para publicar nuevas zonas de alta resolución, se preparan sus recortes antes de compilar. No se garantiza alta resolución online en un hosting estático sin un servicio propio que soporte Range. Esta distinción es explícita; no se presenta el fallback como un DEM de 5 m.

### Preparar otros lugares

Desde la raíz del repositorio:

```powershell
python -m pip install -r tools/requirements-astronaut.txt
python tools/prepare_lunar_dem.py --defaults
python tools/prepare_lunar_dem.py --lat -86.8 --lon 338 --name haworth-extra
python tools/prepare_astronaut_ephemeris.py
python tools/validate_lunar_dem.py
```

Las descargas de origen y kernels se guardan en `.cache/astronaut/`, excluida de Git. La validación online conserva una copia de cada GeoTIFF de demo para comparar muestras con los datos originales; es una operación de preparación, no de apertura del modo. `--offline` verifica hashes, metadatos, alturas válidas y efemérides sin descargar fuentes.

Para importar un **LROC NAC DTM** u otro DEM de mayor resolución:

```powershell
python tools/prepare_lunar_dem.py --source C:/data/nac-registered.tif --source-metadata C:/data/nac-provenance.json --lat -89.45 --lon 222.5 --name nac-demo
```

Debe estar registrado en **MOON_ME_DE421**, estereográfica polar sur sobre esfera de 1,737,400 m, con alturas en metros respecto a esa esfera. No se acepta WGS84. El JSON debe proporcionar `provider`, `productUrl`, `frame`, `verticalDatum`, `uncertainty` y, opcionalmente, `name` e `interpolation`. El importador comprueba proyección y radio; el propietario debe comprobar el marco y datum vertical de la fuente, que un CRS por sí solo no describe completamente. No se transforman silenciosamente datums incompatibles. El catálogo no realiza descubrimiento automático de todos los DTMs NAC; los compatibles se importan y tienen prioridad por su resolución. Una imagen orbital no se acepta como sustituto de un DEM.

## Sol, Tierra y horizonte

Se reutilizan los vectores horarios SPICE existentes (DE440, corrección LT+S). `prepare_astronaut_ephemeris.py` aplica `pxform` de `MOON_ME_DE440_ME421` a `MOON_ME_DE421` en cada muestra UTC usando los kernels NAIF originales; no modifica los datos del mapa. El máximo giro del periodo incluido es aproximadamente 0.057 segundos de arco, registrado en el archivo de metadatos.

El sistema local es **+X este, +Y arriba, −Z norte**. Se resta la posición del observador a los vectores del Sol y la Tierra para obtener direcciones topocéntricas. Se interpolan los vectores horarios y se conservan los tamaños angulares físicos (radio solar 695,700 km; terrestre 6,378.1366 km). La Tierra no se agranda para verla mejor. Su textura y orientación visual son ilustrativas; su posición y tamaño son astronómicos.

La visibilidad combina el horizonte regional existente (malla de 1 km, bins de 5°, alturas calculadas para un observador de unos 2 m, distancias 300 m–300 km) con muestreo del relieve local desde la cámara. La dirección se recalcula al moverse o cambiar el reloj. El HUD distingue visibilidad solar y línea de visión geométrica hacia el centro terrestre. No equivale a disponibilidad real de una red de comunicaciones.

Las sombras visuales usan CSM (3 o 4 cascadas, 1024–4096 según calidad), PCF, bias y normal bias. La iluminación solar se atenúa por la visibilidad calculada en el observador; esa atenuación global aproxima la obstrucción lejana sobre el área, no constituye un mapa de iluminación certificado por cada vértice. El terreno contextual no sustituye el cálculo del horizonte lejano.

## Física y gráficos

Rapier usa la misma malla triangular de la superficie, un controlador de cápsula, paso fijo de 1/60 s, gravedad de 1.62 m/s², aceleración, frenado, salto, deslizamiento por pendientes, obstáculos y límites sólidos de la región. La cámara está aproximadamente a 1.7 m del suelo. Rocas mayores de 0.3 m tienen colisiones conservadoras esféricas; la grava menor se puede superar. El reloj del render no determina el paso físico.

Three.js mantiene el stack React/JavaScript existente. Materiales PBR, color sRGB, ACES, normal/roughness/AO maps, variación de reflectancia según pendiente, rocas instanciadas y culling. El terreno se divide en tiles con LOD por distancia: conserva el detalle nativo cerca de la cámara y todos los vértices de unión entre tiles, simplificando solo los triángulos lejanos. La física conserva la malla completa. HIGH/ULTRA añaden GTAO; se reducen DPR, AO y sombras con rendimiento sostenido bajo. Las sombras estáticas se reutilizan. La calidad gráfica no cambia la escala ni las colisiones. La generación de rocas tiene seed derivada de las coordenadas y depende de pendientes, altura y agrupaciones espaciales; **sus posiciones no son datos medidos**. La exposición fotográfica no es una medición radiométrica calibrada.

El terreno regional se une a **todos** los vértices del perímetro del DTM local. Una franja de transición entre 500 y 750 m desde el centro absorbe las diferencias de altura entre fuentes fuera de la zona caminable. Esto evita los huecos negros que aparecían al unir solo las cuatro esquinas. La transición es contexto visual interpolado; no altera las elevaciones, colisiones ni cálculos de horizonte del kilómetro científico.

No hay atmósfera, niebla ni cielo azul. En noche lunar la superficie es oscura: se ofrece una luz de casco neutra, identificada como artificial, que se atenúa durante el día. Un rebote de luz muy tenue mejora la lectura de las caras de las rocas sin simular un cielo atmosférico; es una aproximación artística. La exposición es ajustable. Se conservan la hora y la dirección solar astronómicas. No se garantizan 60 fps para todas las GPU o navegadores.

## Fab / Quixel Megascans

Se incluyen cuatro superficies de los ZIP facilitados por el propietario: Dry Sand `vd0lbfd`, Soil Sand `pkcbq0`, Dry Sand `xd0jeh2` y Sand `sgfodj1a`. Color, normales y AO/roughness se mezclan en el shader con una gradación gris ceniza de matiz cálido. Los mapas ORM empaquetan AO en R, roughness en G y cero en B. Tres texturas de array WebGL2 contienen las cuatro capas: no se excede el número de samplers con cuatro cascadas de sombras. No se usa displacement sobre las elevaciones científicas.

La arena gris `vd0lbfd` sigue siendo la base de las llanuras. Soil Sand `pkcbq0` alcanza como máximo el 64.5% en las zonas más pedregosas, dejando arena entre sus detalles. Su máscara combina un decaimiento amplio deformado con variaciones a dos escalas, formando vetas y huecos en lugar de un óvalo compacto. La máscara de 512 × 512 conserva transiciones de unos 2 m por muestra. Es exclusiva del material: no cambia elevaciones, piedras ni colisiones. Los otros scans aportan variaciones secundarias de polvo y grano. Al cargar se aproxima la luminancia lineal media de cada scan para compensar diferencias de brillo; se mantienen la gradación lunar y la reflectancia general 0.82. Se elimina el oscurecimiento adicional de Soil Sand para evitar el aspecto de mancha. El relieve normal cercano pasa de 0.62 en arena a un máximo de 0.88 en grava.

Para disimular el tiling de un metro, la arena base mezcla tres muestras con offsets y giros de 90° derivados de una retícula triangular y la semilla del lugar. Soil Sand usa giros libres de 360°, escala por copia entre 0.88 y 1.15, celdas más pequeñas de 0.72 y pesos de mezcla menos concentrados. Así cada zona deja de mostrar una copia entera repetida varias veces. Sus normales no reciben el refuerzo de amplitud que acentuaba el patrón. Color, normales y ORM comparten transformaciones; `textureGrad` mantiene los mipmaps estables y las normales se giran al marco tangente original. Las capas secundarias usan giros diferentes y una deformación suave. Se mantienen los tres samplers de array y las 24 lecturas PBR por fragmento. El rendimiento gráfico sigue dependiendo de la GPU y la resolución.

Se han descargado ocho packs desde la sesión Fab del propietario, bajo la licencia Standard mostrada por Fab. El manifest registra los enlaces originales y archivos fuente:

- Small Rocks Pack `ucdjdfmva`: 5 variantes.
- Limestone Rocks `ub3sddsda`: 1 variante.
- Thai Beach Rocks `ueopcguga`: 1 variante.
- Volcanic Dolerite Rocks `qjmvt`: 1 variante.
- Icelandic Porous Rocks `skxqf`: 1 variante.
- Sharp Rocks Set `rbov2`: 4 variantes.
- Small Limestone Rocks Pack `ufllcisva`: 6 variantes.
- Granite Rocks `pfyss`: 1 variante.

Los originales permanecen en Downloads. Los GLB importados tienen texturas de 1K y dos niveles geométricos que comparten los mismos materiales y mapas. Se separan los componentes de cada pack en 20 variantes; cada una se centra y apoya por su propia base, conservando su forma. Instancing y selección por distancia reducen el coste de la grava lejana. El simplificador limita el error geométrico; algunos modelos mantienen más triángulos para conservar su contorno.

La distribución usa 19 campos elípticos irregulares con abundancia variable, fragmentos de varios tamaños y una dispersión tenue entre ellos. El mismo campo mezcla el material más pedregoso del suelo. Se evita interpenetrar bloques grandes, se despeja el punto inicial y las bases quedan ligeramente enterradas. Los campos son decorativos y reproducibles por coordenadas; no representan posiciones geológicas medidas. La densidad ajusta la grava fina, manteniendo visibles los obstáculos con colisión.

La revisión del 14 de noviembre aumenta los candidatos de cada campo de 240 a 820, conservando la dispersión entre campos. En el terreno plano de prueba del polo sur se pasa de 2,548 a 6,717 piedras a densidad máxima; el número depende del relieve y la semilla. El material del suelo multiplica su reflectancia por 0.82, manteniendo la exposición y los datos de elevación.

Para reducir tirones, se precalculan las transformaciones y colores de las piedras. La selección por distancia se revisa al recorrer 2 m o cambiar calidad/densidad; solo se suben buffers si cambia la selección, con rangos de actualización limitados a las instancias visibles. La grava diminuta usa antes el LOD lejano, deja de dibujarse al ser subpíxel y no proyecta sombras lejanas. Una cuadrícula espacial evita comprobar cada bloque contra todas las piedras al generar los campos. Las sombras se invalidan por cambios reales de cámara, Sol, hora o geometría, con un máximo de unos 30 Hz; mantener Pointer Lock sin moverse no las recalcula. GTAO usa buffers intermedios al 60% en HIGH y 75% en ULTRA; la resolución del composer también se adapta al DPR. Se preparan shaders y el primer fotograma antes de mostrar los controles. No se renderiza una pestaña oculta.

Una segunda pasada añade grava de radio 1.8–9 cm, concentrada en los campos y con una dispersión suave por las llanuras. Conserva los bloques y sus colisiones anteriores; solo la grava puede acercarse hasta 1.1 m al punto inicial. En la fixture plana del polo sur a densidad máxima hay 29,162 piedras nuevas y se mantienen los 803 bloques anteriores. Esta grava utiliza directamente las mallas simplificadas de Quixel, comparte los batches existentes, recibe sombras y se dibuja solo cerca del caminante; no añade sombras propias ni colliders. La densidad visual también la regula.

Reimportar desde los originales locales:

```powershell
python tools/import_quixel_surfaces.py C:/Users/Usuario/Downloads
cd web
node scripts/prepare-quixel-rocks.mjs C:/Users/Usuario/Downloads
```

El importador de superficies necesita Pillow. El optimizador usa glTF Transform, Meshoptimizer y Sharp, incluidos como dependencias de desarrollo. Los assets usados y sus fuentes están en `web/public/assets/astronaut/manifest.json`; la aplicación no accede a Fab, cuentas ni credenciales. Sigue siendo posible añadir modelos estáticos al manifest. Meshopt está soportado; KTX2/Draco requieren configurar sus decodificadores. Si falla un asset opcional, se conserva el material o modelo de reserva y se registra el aviso.

## Validación

```powershell
cd web
npm test
npm run build
cd ../pipeline
python -m pytest tests -q
cd ..
python tools/validate_lunar_dem.py
```

Las pruebas nuevas comprueban orientación ENU, escala, curvatura, muestreo, NoData, diagonales triangulares, vectores e interpolación astronómica, tamaño angular, obstrucción por horizonte, determinismo, hashes NASA, caminar, salto lunar, colisión con rocas y límites. Las pruebas anteriores de geometría/visibilidad se mantienen. Las comprobaciones de navegador verifican apertura, movimiento, cambio temporal, regreso al mapa y lectura de datos reales. El rendimiento depende del equipo y requiere medir en los dispositivos objetivo.

### Resultado de la validación del 14 de noviembre de 2026

Integración de Soil Sand: **21 pruebas de Node** y compilación pasan. La prueba del material comprueba en cuatro lugares que sigan apareciendo detalles pedregosos cerca del inicio, que entre ellos haya arena y que la mezcla cambie de forma gradual al caminar, conservando las llanuras. Se revisa el render con la luz del casco encendida y apagada para distinguir el material de la iluminación artificial.

Corrección de la visibilidad de la textura rocosa: **21 pruebas de Node** pasan. La prueba añadida verifica que la franja pedregosa sea alcanzable a pocos pasos, cubra una región y aparezca también en otros campos, conservando arena en la mayor parte del terreno. El navegador muestra la diferencia entre arena y grava en el punto inicial del lugar seleccionado por el usuario, sin errores de shader.

Revisión de mezcla sutil, tiling y grava: **20 pruebas de Node** pasan. Se comprueban la cantidad y tamaño de la grava nueva, la conservación de los 803 bloques de la fixture anterior, el uso de los batches simplificados sin sombras extra, el descarte por distancia y la reutilización de buffers. El navegador carga el shader estocástico y las cuatro superficies sin errores de compilación; se compara el mismo punto de Haworth con el mismo reloj e iluminación. No se certifica una tasa de fotogramas estable a partir de estas comprobaciones.

Revisión de hora, variedad y rendimiento: **19 pruebas de Node** pasan, incluida la reutilización de buffers en reposo, los cambios de LOD, la conservación de bloques con colisión al reducir grava, la limpieza de instancias y los 20 modelos Quixel. Comprobación de navegador: captura real del ratón, Escape con captura activa abriendo la hora, cambio de hora con botones y teclado, reanudación y movimiento WASD, y cambios MEDIUM/ULTRA/HIGH. Los 20 modelos y cuatro superficies cargan sin fallbacks; no aparecen errores de shader. Estas comprobaciones no certifican una tasa de fotogramas estable en otros dispositivos.

- **18 pruebas de Node**: pasan, incluidas captura/pausa/reanudación, deltas relativos, rechazos de captura, campos de rocas, assets Quixel y unión de DEM con alturas diferentes. Las **9 pruebas de Python** pasaron en la validación anterior; esta revisión no cambia el pipeline científico.
- Compilación de producción y `git diff --check`: pasan. Vite avisa del tamaño del módulo de física cargado bajo demanda y de referencias CSS públicas que se resuelven en ejecución; se verificó que esos archivos se incluyen y cargan en la versión estática.
- Dos recortes: **194,481 alturas válidas cada uno**, SHA-256 comprobado y cuatro muestras por recorte contrastadas con cada GeoTIFF original de NASA. Efemérides: **43,824** muestras horarias válidas.
- Navegador sobre la compilación estática: entrada desde el casco, coordenadas, WASD, cambio de fecha, búsqueda de luz solar, ajustes de calidad, demo, fallback de 240 m y salida conservando coordenadas/reloj. Emulación táctil: movimiento confirmado mediante cambios de coordenadas.
- Desarrollo: lectura de otro lugar de Haworth a **5 m**, fuera del recorte empaquetado, mediante HTTP Range y el proxy NASA.
- Tras corregir el shader de materiales no se observaron errores de renderizado en las comprobaciones finales. Un favicon ausente es anterior a esta función.
- Captura nativa confirmada en Chromium: `pointerLockElement` es el canvas y `cursor` es `none`; rotación por deltas relativos, Escape y panel de ajustes comprobados. Algunos intentos en ventanas sin foco fueron rechazados y permanecieron correctamente en pausa. Se verificaron 13 variantes Quixel y cuatro mapas de superficie cargados sin fallbacks. Los dispositivos móviles físicos no se han probado.
- Reproducción del punto **84.18408° S, 76.12220° E, 2027-10-02 22:00 UTC**, con DTM NASA de 10 m: los huecos persistían sin sombras y desaparecían al ocultar el contexto, identificando la unión entre DEM como causa. Después de unir todos los bordes desaparecen las franjas negras; se reduce la intensidad solar para conservar el gris del regolito.
- No se certifica el objetivo de 60 fps: la calidad se adapta y el LOD reduce trabajo de geometría lejana, pero siguen siendo necesarias mediciones en el hardware objetivo.

## Archivos de esta implementación

- `web/src/screens/Site.jsx`: activación del casco y salida conservando el estado.
- `web/src/astronaut/AstronautMode.jsx`, `astronaut.css`: interfaz, carga, ajustes, controles táctiles y reloj.
- `web/src/astronaut/AstronautScene.js`: renderer, CSM, GTAO, control de cámara, adaptación y limpieza GPU.
- `web/src/astronaut/coordinates.js`, `terrain.worker.js`, `TerrainLoader.js`: geometría científica, cobertura, lectura de GeoTIFF, recortes y caché.
- `web/src/astronaut/TerrainLOD.js`: detalle cercano y simplificación lejana con bordes continuos.
- `web/src/astronaut/TerrainContext.js`: unión continua entre DEM local y regional fuera de la zona caminable.
- `web/src/astronaut/FirstPersonControls.js`: captura relativa, pausa, Escape y controles táctiles.
- `web/src/astronaut/CelestialPosition.js`: posiciones topocéntricas, tamaños y visibilidad.
- `web/src/astronaut/LunarPhysics.js`: Rapier y controlador físico.
- `web/src/astronaut/SurfaceMaterials.js`, `SurfaceGeology.js`, `ProceduralRocks.js`, `MegascansLibrary.js`: materiales, campos de fragmentos y assets del propietario.
- `web/src/astronaut/astronaut.test.mjs`: pruebas científicas y físicas.
- `web/public/data/astronaut/`: catálogo, dos recortes de 5 m, DEM regional nativo, etiqueta PDS y efemérides transformadas.
- `web/public/assets/astronaut/manifest.json`: configuración de modelos y materiales.
- `web/package.json`, `web/package-lock.json`: dependencias y comando de pruebas.
- `web/vite.config.js`: proxy de lectura de DEM públicos durante desarrollo.
- `tools/prepare_lunar_dem.py`, `prepare_astronaut_ephemeris.py`, `validate_lunar_dem.py`, `requirements-astronaut.txt`: pipeline reproducible y validación.
- `README.md`, `docs/ASTRONAUT_MODE.md`: acceso, fuentes y límites.

Los cambios previos del proyecto se conservan; no se realizan modificaciones en bases de datos ni despliegues.
