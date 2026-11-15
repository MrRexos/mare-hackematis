# Astronaut Mode

Modo integrado en **Mare → Lander's View → casco Astronaut Mode**. Utiliza las coordenadas seleccionadas y el reloj UTC compartido. La reproducción del reloj del mapa se detiene al entrar para que solo controle el tiempo el panel de Astronaut Mode. **Exit** vuelve a la ficha; conserva el punto y la fecha, incluidos los cambios temporales hechos dentro del modo.

## Ejecutar

```powershell
cd web
npm install
npm run dev
```

Los datos necesarios están incluidos en `web/public/data/astronaut/`: no hay que ejecutar Python para explorar las regiones preparadas o el DEM regional. El código de física y renderizado se carga cuando se pulsa el casco.

Controles: **Start exploring**, WASD o flechas para caminar, ratón para mirar, Shift para desplazarse más rápido, Espacio para saltar, R para volver al centro. Mantener pulsada la Z o el botón derecho acerca la vista 4 aumentos, como un teleobjetivo, para mirar la Tierra o una cresta lejana. **Escape libera el ratón, pausa y abre directamente la fecha y hora**. El menú permite alternar entre **Date & time**, **Settings** y **Sources**; **Resume exploring**, disponible en los tres paneles, vuelve a capturar el ratón mediante un gesto del usuario. El ratón desaparece durante la exploración. El escritorio usa exclusivamente deltas relativos con Pointer Lock, sin arrastre por coordenadas de pantalla; se descarta el primer evento de captura y los saltos espurios del controlador. La pérdida de foco también pausa. Si el navegador rechaza la captura, permanece en pausa y ofrece reintentarlo. Requiere `localhost` o HTTPS. En pantalla táctil se arrastra la vista y se usan los botones de movimiento.

El panel de calendario cambia fecha/hora UTC y ofrece un avance temporal de 6 horas reales por segundo. **Find sunlight** busca una hora con el disco solar visible desde la posición actual dentro del periodo de misión; cambia la fecha únicamente al pulsarlo y avisa si no encuentra luz. Una elevación solar positiva no implica visibilidad si hay relieve delante. No se simula un día terrestre. Ajustes: LOW, MEDIUM, HIGH, ULTRA, campo de visión, sensibilidad, densidad visual de grava y minimapa. El casco dispone de una luz artificial identificada y desactivable; permite explorar lugares sin luz solar.

## Datos científicos incluidos

| Producto | Uso | Espaciado | Fuente |
| --- | --- | --- | --- |
| LOLA Site01, Connecting ridge | Demo en −89.45°, 222.5°E; recorte de 2.2 km para escoger una región explorable de 1 km | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LOLA Haworth | Recorte de 2.2 km en −86.86°, 338.14°E | 5 m | [NASA PGDA 78](https://pgda.gsfc.nasa.gov/products/78) |
| LDEM_75S_240M | Cobertura regional para cualquier punto del mapa y terreno contextual hasta 16 km | 240 m | [NASA PDS LOLA](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.lbl) |
| Catálogo PGDA de DEM de 5 m y LDEM_83S_10MPP_ADJ | Selección por cobertura y resolución en desarrollo | 5 / 10 m | [PGDA 78](https://pgda.gsfc.nasa.gov/products/78), [PGDA 90](https://pgda.gsfc.nasa.gov/products/90) |

`catalog.json` registra producto, URL, proveedor, cobertura, proyección, marco, datum vertical, resolución y limitaciones de incertidumbre. Cada recorte incluye SHA-256 y fracción válida; los recortes incluidos tienen todos sus valores válidos. Los DEM LOLA de 5 m contienen interpolación entre medidas; **5 m de espaciado no significa 5 m de resolución efectiva ni precisión de altura**. La incertidumbre por muestra no está incluida; se enlazan los productos originales con sus mapas de error.

Las alturas se obtienen del raster científico. La malla de referencia mide exactamente **1,000 × 1,000 unidades**, con una unidad por metro, e incorpora la curvatura lunar. No hay exageración vertical. Esa malla, interpolada de forma bilineal, se conserva sin cambios: se usa para el minimapa, el cálculo del horizonte cercano y la unión con el terreno regional. Cuando se interpola el DEM de 240 m sobre una malla más densa, la interfaz sigue mostrando **240 m**.

La superficie que se dibuja y se pisa es otra, descrita en el apartado siguiente: parte del mismo DEM y le añade el relieve que el DEM no puede resolver.

Se rechaza una región con NoData o cobertura incompleta; se intenta la siguiente fuente compatible. Los huecos del DEM no se rellenan con ruido ni con elevaciones inventadas. El worker evita bloquear la interfaz. La caché de tres terrenos conserva coordenadas, versión del catálogo, fuentes, resoluciones y hashes; reutiliza el resultado al volver a abrirlo y se invalida al cambiar los datos.

### Relieve por debajo de la resolución del DEM

Un DEM de 5 m no contiene cráteres de 3 m, y uno de 240 m no contiene casi ninguno de los que se ven al caminar. Con solo el DEM el suelo era una rampa lisa, que es justo lo que no se ve en las fotografías de superficie del Apolo. `SurfaceRelief.js` genera lo que falta. Es relieve verosímil, no medido, y la interfaz lo dice en el pie y en el panel **Sources**.

- La superficie tiene 2049 × 2049 muestras, una cada 0.49 m. El DEM se interpola con Catmull-Rom, que pasa por todas las muestras medidas y evita las aristas de la interpolación bilineal bajo luz rasante.
- Se añaden cráteres de 2 m hasta cuatro veces el espaciado del DEM (20 m con el de 5 m, 140 m con el de 240 m). Por encima de ese tamaño manda el DEM.
- Los tamaños siguen la población lunar de equilibrio de Trask (1966): N(>D) = 10^-1.1 · D^-2 cráteres por m². Solo se dibuja el 26 % de esa población. El resto corresponde a cráteres tan gastados que nadie los distinguiría de pie; con el 100 % el suelo parecía una vista orbital. Ese porcentaje es una decisión visual contrastada con las fotografías, no un dato.
- Nueve de cada diez son viejos: cuencos de pocos centímetros de profundidad, sin borde. Los jóvenes, con borde levantado y eyecta, son la excepción. El contorno nunca es un círculo perfecto.
- Un cráter joven y mayor borra los más pequeños y viejos que quedaban dentro. El punto de llegada se mantiene despejado y siempre hay un cráter joven a menos de 46 m.
- Se suma una ondulación suave de decenas de metros de longitud de onda, entre 0.2 y 0.9 m según la resolución del DEM.
- En los últimos 34 m antes del borde del kilómetro el relieve añadido se desvanece, y en los últimos 12 m la superficie vuelve a la malla del DEM. Así encaja sin escalón con el terreno regional.

La semilla sale de las coordenadas: el mismo lugar da siempre el mismo suelo. El worker tarda alrededor de 1 s en generarlo. Fuera del kilómetro caminable el terreno regional sigue siendo el DEM de 240 m sin relieve añadido.

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

El sistema local es **+X este, +Y arriba, −Z norte**. Se resta la posición del observador a los vectores del Sol y la Tierra para obtener direcciones topocéntricas. Se interpolan los vectores horarios y se conservan los tamaños angulares físicos (radio solar 695,700 km; terrestre 6,378.1366 km). La Tierra no se agranda para verla mejor: mide 1.8° de diámetro, unas 3.7 veces la Luna vista desde la Tierra. En pantalla ocupa poco porque el campo de visión es amplio; para verla grande está el teleobjetivo (Z o botón derecho). El campo de visión por defecto baja de 72° a 64°.

La Tierra usa la imagen NASA Blue Marble Next Generation (dominio público, tomada del paquete npm `three-globe`) reducida a 2048 × 1024. Las nubes son sintéticas: ruido fractal con las bandas de la circulación general, generado con `tools/make_astronaut_earth.py`. No reproducen el tiempo de ninguna fecha. La orientación sí se calcula para el instante elegido: el eje terrestre y el meridiano de Greenwich se obtienen de la longitud eclíptica del Sol y del tiempo sidéreo, y la cara iluminada, de la dirección Tierra-Sol de las efemérides. El plano de la eclíptica se aproxima con el ecuador lunar, lo que deja un error de hasta 1.5° en la inclinación del globo. Las pruebas comprueban el punto subsolar (latitud dentro de 0.5°, longitud dentro de la ecuación del tiempo) en cuatro fechas.

El Sol conserva su disco de 0.53° y añade un halo: un núcleo estrecho y un velo ancho y débil, como el que produce un punto muy brillante en el ojo o en un objetivo. El halo se apaga con la fracción visible del disco.

La visibilidad combina el horizonte regional existente (malla de 1 km, bins de 5°, alturas calculadas para un observador de unos 2 m, distancias 300 m–300 km) con muestreo del relieve local desde la cámara. La dirección se recalcula al moverse o cambiar el reloj. El HUD distingue visibilidad solar y línea de visión geométrica hacia el centro terrestre. No equivale a disponibilidad real de una red de comunicaciones.

Las sombras visuales usan CSM (3 o 4 cascadas, 1024–4096 según calidad), PCF, bias y normal bias. Los faldones que tapan las juntas entre piezas de terreno no entran en el mapa de sombras: con el Sol a 2° una pared vertical en la junta sombreaba decenas de metros de suelo detrás. La iluminación solar se atenúa por la visibilidad calculada en el observador; esa atenuación global aproxima la obstrucción lejana sobre el área, no constituye un mapa de iluminación certificado por cada vértice. El terreno contextual no sustituye el cálculo del horizonte lejano.

## Física y gráficos

Rapier usa un campo de alturas con las mismas 2049 × 2049 muestras que se dibujan, un controlador de cápsula, paso fijo de 1/60 s, gravedad de 1.62 m/s², aceleración, frenado, salto, deslizamiento por pendientes, obstáculos y límites sólidos de la región. La cámara está aproximadamente a 1.7 m del suelo. Rocas mayores de 0.3 m tienen colisiones conservadoras esféricas; la grava menor se puede superar. El reloj del render no determina el paso físico.

Three.js mantiene el stack React/JavaScript existente: color sRGB, ACES, mapas de color y normales, rocas instanciadas y culling. El terreno es un quadtree de nodos de 32 × 32 celdas. Un nodo se divide en cuatro mientras el caminante está más cerca que una fracción de su anchura (0.3 en LOW, 0.85 en ULTRA), de modo que bajo los pies hay celdas de 0.49 m y a cientos de metros, de 8 o 16 m. Los nodos se construyen al necesitarse y se liberan los menos usados. La física usa siempre la superficie completa. Con rendimiento sostenido bajo se reducen DPR, sombras y alcance del detalle. Las sombras estáticas se reutilizan. La calidad gráfica no cambia la escala ni las colisiones. La exposición fotográfica no es una medición radiométrica calibrada.

El suelo lunar no refleja como una superficie mate. Devuelve la luz hacia el Sol, se aclara de golpe alrededor de la sombra del propio observador y mantiene el brillo con luz rasante. El shader sustituye la ley de Lambert por el modelo de Hapke con los valores de la Luna entera de Helfenstein y Veverka (1987, [informe técnico de la NASA](https://ntrs.nasa.gov/citations/19870013999)): albedo de partícula 0.21, anchura del efecto de oposición 0.07, términos de fase 0.29 y 0.39. La amplitud de oposición 2.01 no aparece tal cual en su tabla: sale de su S(0) = 0.71 dividido por el albedo y por la función de fase en oposición (0.21 × 1.68). Falta el término de rugosidad macroscópica de Hapke; lo sustituye un factor empírico que oscurece hasta un 60 % el suelo visto a contraluz con Sol bajo. No hay término especular. Con el Sol a 2.5°, el suelo llano refleja entre 2 y 14 veces más que con Lambert según hacia dónde se mire (más con el Sol a la espalda y a lo lejos, casi igual a contraluz). Lambert lo dejaba casi negro, y las rocas, con caras orientadas al Sol, parecían encendidas a su lado. Rocas y suelo comparten modelo y reflectancia: cada textura de roca se escala a la reflectancia media del regolito.

El cielo es negro y no ilumina. El único relleno es la luz solar que devuelve el propio suelo: llega a las caras verticales y a la parte baja de las cosas, y casi nada al suelo llano en sombra. La luz de la Tierra se incluye con su fase; de día es inapreciable y de noche es la única luz natural. La noche se muestra más clara de lo que saldría con la exposición diurna, como la vería un ojo adaptado.

El terreno regional se une a **todos** los vértices del perímetro del DTM local. Una franja de transición entre 500 y 750 m desde el centro absorbe las diferencias de altura entre fuentes fuera de la zona caminable. Esto evita los huecos negros que aparecían al unir solo las cuatro esquinas. La transición es contexto visual interpolado; no altera las elevaciones, colisiones ni cálculos de horizonte del kilómetro científico.

No hay atmósfera, niebla ni cielo azul. En noche lunar la superficie es oscura: se ofrece una luz de casco neutra, identificada como artificial, que de día queda casi apagada porque no puede competir con el suelo al sol. No proyecta sombras: una luz situada en el ojo las deja justo detrás de lo que ilumina, donde no se ven. La exposición es ajustable. Se conservan la hora y la dirección solar astronómicas. No se garantizan 60 fps para todas las GPU o navegadores.

## Fab / Quixel Megascans

Se incluyen cuatro superficies de los ZIP facilitados por el propietario: Dry Sand `vd0lbfd`, Soil Sand `pkcbq0`, Dry Sand `xd0jeh2` y Sand `sgfodj1a`. Color y normales se mezclan en el shader con una gradación gris ceniza de matiz cálido. Dos texturas de array WebGL2 contienen las cuatro capas. Los mapas ORM (AO en R, roughness en G) siguen en el paquete pero ya no se cargan: sin término especular la rugosidad no cambia nada, y sin luz ambiente no hay oclusión que aplicar. Son unos 20 MB menos de memoria de GPU y 5.3 MB menos de descarga.

Los cráteres de 12 cm a 2 m, demasiado pequeños para la malla, se representan con un mapa de pendientes de 1024 × 1024 que cubre 24 m y se repite sin costura. Se lee dos veces, a 24 y 37 m y con giros distintos, y las dos copias nunca coinciden.

La arena gris `vd0lbfd` sigue siendo la base de las llanuras. Soil Sand `pkcbq0` alcanza como máximo el 64.5% en las zonas más pedregosas, dejando arena entre sus detalles. Su máscara combina un decaimiento amplio deformado con variaciones a dos escalas, formando vetas y huecos en lugar de un óvalo compacto. La máscara de 512 × 512 conserva transiciones de unos 2 m por muestra. Es exclusiva del material: no cambia elevaciones, piedras ni colisiones. Los otros scans aportan variaciones secundarias de polvo y grano. Al cargar se aproxima la luminancia lineal media de cada scan para compensar diferencias de brillo; se mantienen la gradación lunar y la reflectancia general 0.82. Se elimina el oscurecimiento adicional de Soil Sand para evitar el aspecto de mancha. El relieve normal cercano pasa de 0.62 en arena a un máximo de 0.88 en grava.

Para disimular el tiling de un metro, la arena base mezcla tres muestras con offsets y giros de 90° derivados de una retícula triangular y la semilla del lugar. Soil Sand usa giros libres de 360°, escala por copia entre 0.88 y 1.15, celdas más pequeñas de 0.72 y pesos de mezcla menos concentrados. Así cada zona deja de mostrar una copia entera repetida varias veces. Sus normales no reciben el refuerzo de amplitud que acentuaba el patrón. Color, normales y ORM comparten transformaciones; `textureGrad` mantiene los mipmaps estables y las normales se giran al marco tangente original. Las capas secundarias usan giros diferentes y una deformación suave. Las lecturas de textura del suelo bajan de 24 por fragmento a 11 en el caso habitual: 6 de la arena, 2 del polvo, 2 de microcráteres y 1 de la máscara. La grava y la capa gruesa solo se leen junto a las rocas, donde pesan en la mezcla. A partir de unos 30 m el suelo está tan escorzado que el escaneado de un metro es una mancha de pocos téxeles, y basta una lectura simple de color y otra de normal. El rendimiento gráfico sigue dependiendo de la GPU y la resolución.

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

En la Luna la roca sale de los impactos, y la distribución sigue ahora a los cráteres generados. Sustituye a los 19 campos elípticos y a la dispersión uniforme anteriores, que dejaban piedras sueltas repartidas al azar.

- Los cráteres jóvenes de 5 m o más conservan bloques. Cuanto mayor es el cráter, más y mayores: uno de 11 m da bloques de hasta 1.2 m; uno de 100 m, de varios metros. Una cuarta parte queda en el fondo y la pared. El resto cae fuera, más denso en el borde y repartido en rayos, con los bloques grandes más cerca.
- El resto del terreno tiene grupos sueltos: un bloque roto con sus fragmentos alrededor, más algunas piedras aisladas.
- Los tamaños siguen una ley de potencias. Cada vez que el tamaño se reduce a la mitad hay varias veces más piezas.
- Cada roca se hunde entre un 6 y un 48 % de su radio, con proporciones e inclinación propias. Los bloques no se quedan en paredes empinadas ni se solapan.

En la fixture plana del polo sur a densidad máxima salen 12,812 rocas de 20 cm o más, de ellas 701 con colisión. El 81 % tiene otra roca a menos de 3 m; un reparto uniforme de la misma densidad daría un 30 %.

Las piedras de 4 a 20 cm ya no se guardan para todo el kilómetro. Una superficie real tiene cerca de una por metro cuadrado (recuentos de las Surveyor), más de un millón en total. Se generan por celdas de 6 m alrededor del caminante, cada celda con su propia semilla, y se dibujan en cuatro llamadas instanciadas. La mitad cae en grupos pequeños. Solo las que están a menos de 12 m proyectan sombra, y cada piedra deja de dibujarse cuando ocuparía un píxel. La densidad visual de los ajustes la regula.

La misma máscara de geología mezcla el suelo más pedregoso alrededor de los cráteres jóvenes y en algunas franjas de regolito con más guijarros. Rocas, grava y máscara son reproducibles por coordenadas y **no son posiciones medidas**.

Las transformaciones y colores de las rocas se precalculan. La selección por distancia se revisa al recorrer 2 m o cambiar calidad o densidad, y solo se suben buffers si cambia. Cada lote instanciado tiene ahora una esfera envolvente ajustada a lo que dibuja, de modo que una cascada de sombras que no lo contiene no lo procesa. Las sombras se invalidan por cambios reales de cámara, Sol, hora o geometría, con un máximo de unos 30 Hz. Se preparan shaders y el primer fotograma antes de mostrar los controles. No se renderiza una pestaña oculta.

GTAO se ha retirado. La oclusión ambiental atenúa luz ambiente, y bajo un cielo negro apenas hay; aplicada a todo el fotograma oscurecía también la luz solar directa, lo que es incorrecto. Con ella desaparecen la cadena de posproceso y sus pasadas adicionales en HIGH y ULTRA.

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

Las pruebas comprueban orientación ENU, escala, curvatura, muestreo, NoData, diagonales triangulares, vectores e interpolación astronómica, tamaño angular, obstrucción por horizonte, determinismo, hashes NASA, caminar, salto lunar, colisión con rocas y límites. Desde el 15 de noviembre también la distribución de tamaños de los cráteres, el perfil de un cráter, la coincidencia de la superficie con el DEM en el borde, el quadtree del terreno, el modelo fotométrico, la orientación de la Tierra, la agrupación de las rocas y la grava por celdas. Las pruebas anteriores de geometría/visibilidad se mantienen. Las comprobaciones de navegador verifican apertura, movimiento, cambio temporal, regreso al mapa y lectura de datos reales. El rendimiento depende del equipo y requiere medir en los dispositivos objetivo.

### Resultado de la validación del 15 de noviembre de 2026

Revisión de iluminación, relieve, rocas y cielo. **30 pruebas de Node** y la compilación pasan. Se sustituyen tres pruebas que describían el sistema anterior (LOD por tiles, 19 campos de rocas y su recuento exacto de 803 bloques) por las del sistema nuevo, y se añaden diez.

Comprobación visual con Chromium y renderizador por software (SwiftShader) en tres casos: un punto del mapa con DEM de 240 m, la demo de Connecting ridge con DEM de 5 m, y de noche. Se compararon con las fotografías del Apolo facilitadas por el propietario. No hubo errores de shader.

Coste por fotograma, mismo punto, misma hora, 960 × 540, renderizador por software:

| | Antes | Ahora |
| --- | --- | --- |
| MEDIUM, cámara quieta | 4.0 s | 3.6 s |
| MEDIUM, girando | 4.1 s | 3.8 s |
| HIGH, cámara quieta | 2.2 s | 3.6 s |
| Llamadas de dibujo (pasada principal) | 104 | 79 |
| Triángulos (pasada principal) | 438,000 | 330,000 |

Estas cifras no son fotogramas por segundo de una GPU. El renderizador por software penaliza cosas que una GPU resuelve casi gratis, sobre todo el antialiasing por multimuestreo. Por eso el HIGH anterior sale más rápido: su cadena de posproceso dibujaba sin multimuestreo, con bordes dentados. En este entorno el 98 % del tiempo del fotograma es el shader del suelo. **No se ha medido en una GPU real**; la mejora en MEDIUM es del 10 % aquí y no se puede afirmar más.

Lo que queda sin hacer o sin comprobar:

- El polo sur tiene el Sol a menos de 3° sobre el horizonte. Las fotografías del Apolo se tomaron con el Sol entre 15° y 45°, y esa luz no se puede reproducir en estos lugares. La escena polar es más contrastada y con sombras más largas.
- Las sombras son nítidas. Con el Sol tan bajo la penumbra real es ancha (el disco solar mide 0.53°) y no se simula.
- El terreno más allá del kilómetro caminable no tiene cráteres añadidos y se ve más liso que el interior.
- Al acercarse, los nodos del terreno cambian de nivel de detalle y los cráteres pequeños aparecen de golpe a media distancia.
- No se ha abierto en dispositivos móviles ni se ha probado la captura del ratón después de estos cambios; las pruebas de `FirstPersonControls` siguen pasando.

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
- `web/src/astronaut/AstronautScene.js`: renderer, CSM, luces, Sol y Tierra, teleobjetivo, control de cámara, adaptación y limpieza GPU.
- `web/src/astronaut/coordinates.js`, `terrain.worker.js`, `TerrainLoader.js`: geometría científica, cobertura, lectura de GeoTIFF, recortes y caché.
- `web/src/astronaut/SurfaceRelief.js`: cráteres y ondulación por debajo de la resolución del DEM, superficie caminable y sus niveles de detalle.
- `web/src/astronaut/TerrainLOD.js`: quadtree del terreno, con nodos construidos bajo demanda.
- `web/src/astronaut/TerrainContext.js`: unión continua entre DEM local y regional fuera de la zona caminable.
- `web/src/astronaut/FirstPersonControls.js`: captura relativa, pausa, Escape y controles táctiles.
- `web/src/astronaut/CelestialPosition.js`: posiciones topocéntricas, tamaños, visibilidad y orientación de la Tierra.
- `web/src/astronaut/LunarPhysics.js`: Rapier y controlador físico.
- `web/src/astronaut/SurfaceMaterials.js`, `SurfaceGeology.js`, `ProceduralRocks.js`, `MegascansLibrary.js`: modelo fotométrico y materiales, eyecta de los cráteres, rocas, grava y assets del propietario.
- `web/src/astronaut/astronaut.test.mjs`: pruebas científicas y físicas.
- `web/public/data/astronaut/`: catálogo, dos recortes de 5 m, DEM regional nativo, etiqueta PDS y efemérides transformadas.
- `web/public/assets/astronaut/manifest.json`: configuración de modelos y materiales.
- `web/public/assets/astronaut/sky/earth_2k.jpg`: textura de la Tierra (NASA Blue Marble con nubes sintéticas).
- `web/package.json`, `web/package-lock.json`: dependencias y comando de pruebas.
- `web/vite.config.js`: proxy de lectura de DEM públicos durante desarrollo.
- `tools/prepare_lunar_dem.py`, `prepare_astronaut_ephemeris.py`, `validate_lunar_dem.py`, `requirements-astronaut.txt`: pipeline reproducible y validación.
- `README.md`, `docs/ASTRONAUT_MODE.md`: acceso, fuentes y límites.

Los cambios previos del proyecto se conservan; no se realizan modificaciones en bases de datos ni despliegues.
