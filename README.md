# Binarios de capas G1K (T9 + ice.hydrogen_ppm + ice.water_equivalent_wt_pct)

Rama solo de datos: no se fusiona con `main`. Los `layer.json` están en `main`/`joel/recursos-y-eyecta`.

Cada archivo es `UInt16` little-endian, 10 916 × 5 458, fila 0 = +90°, columna 0 = −180°, centro de celda, comprimido con gzip.

```bash
gunzip -k G1K/<id>.G1K.static.u16.gz
mv G1K/<id>.G1K.static.u16 ../layers/<id>/G1K/static.u16   # valor = entero × scale; 65535 = sin dato
```
El sha256 de `layer.json` es el del archivo descomprimido.
