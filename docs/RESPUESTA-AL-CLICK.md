# Respuesta de botones y ventanas — TiendaSmart

Esta actualización reduce las pausas al abrir ventanas y al exportar Excel.
Conserva los reportes exclusivamente en Excel y el Centro de sincronización
con confirmaciones de escritura, errores, reintentos y conflictos visibles.

## Cambios

- Exportar muestra la ventana antes de calcular la vista previa. La búsqueda
  del producto vendido usa un índice y el stock al cierre se calcula una vez
  por producto principal. La vista previa tiene páginas de 80 productos;
  el archivo Excel incluye todos los registros del período.
- Compras reutiliza resúmenes de las facturas y normaliza sus líneas completas
  al seleccionar una. No reconstruye todas las líneas al abrir el listado.
- Personal tiene páginas de 40 personas y un índice de turnos abiertos.
  Proveedores y normalización de vistas evitan recorridos repetidos cuando
  no cambiaron los datos. Guardados y cambios de la nube invalidan las vistas.
- Las tareas de cada ventana se ejecutan de una en una entre actualizaciones
  de pantalla. Las tablas de Exportar y Control diario agregan diez filas por
  turno; cerrar la ventana cancela sus tareas pendientes.
- Control diario reutiliza sus cálculos y conserva conteos físicos y caja
  al reabrir el mismo día. Los campos de las filas que aparecen después
  también reciben sus eventos. Cambiar de fecha inicia el conteo de esa fecha.
- Finalizar venta muestra «Guardando venta…» y evita el doble envío mientras
  confirma la transacción local. La actualización del panel ocurre después.
- Los cinco exportadores crean las hojas y comprimen el XLSX en un Worker
  local usando la biblioteca ya incluida. La interfaz muestra «Preparando
  Excel…» cuando corresponde. Una segunda solicitud idéntica comparte el
  trabajo y no genera otro archivo. El Worker termina tras 30 segundos sin
  trabajo y al cerrar la página. Los navegadores que lo bloqueen conservan
  el exportador compatible, que puede producir una pausa durante el archivo.
- La exportación del control diario obtiene los datos sin reconstruir sus
  tablas de pantalla. El Service Worker v7 actualiza la caché de la aplicación.

## Verificación

`npm run check` valida sintaxis, recursos locales e identificadores originales.
`npm test` ejecuta 67 comprobaciones en Chromium: las 53 existentes y 14 nuevas.
Incluyen transacciones durables, errores de almacenamiento, ventas consecutivas,
stock vinculado, saldos, PIN, doble envío, sincronización, recarga offline,
escáner sintético, cancelación de tareas, conteos y paginación. Los cinco XLSX
generados por Worker se vuelven a leer y se comparan con el exportador compatible.
El inventario de 5.000 productos se exporta completo.

No se usan Firebase ni datos reales. Las solicitudes externas se bloquean y
los perfiles de navegador de las pruebas son desechables. Evidencia en
[`mediciones-click`](./mediciones-click/).

## Mediciones reproducibles

Referencia: revisión `52e449724e8307d2395d607445328a82c7e1ac0f` de la rama de
mejoras anterior. La página pública todavía servía `4afbd249` al iniciar esta
revisión; estas cifras comparan con la rama anterior, no con ese HTML público.
Chromium 156, ventana de 412 × 915 y CPU ralentizada seis veces. Datos sintéticos:
1.000/5.000 productos, 10.000 ventas, 1.000 compras de 20 líneas, 500 proveedores,
100 personas y 5.000 movimientos de producto. Cada ventana se abre dos veces.

Con 5.000 productos:

| Medida | Referencia | Actualización |
| --- | ---: | ---: |
| Trabajo síncrono del clic en Exportar, primera apertura | 3.584 ms | 22 ms |
| Trabajo síncrono del clic en Ingreso, primera apertura | 193 ms | 53 ms |
| Trabajo síncrono del clic en Personal, primera apertura | 146 ms | 9 ms |
| Mayor intervalo entre cuadros al abrir Control diario | 517 ms | 300 ms |
| Mayor intervalo entre cuadros al reabrir Control diario | 483 ms | 83 ms |
| Mayor intervalo entre cuadros durante Excel de inventario | 883 ms | 33 ms |
| Duración total de ese Excel | 888 ms | 474 ms |

El trabajo del clic termina antes que la carga progresiva del contenido.
Estos son registros de laboratorio, con variación entre ejecuciones; no son
una garantía de latencia ni una medición en el celular físico del negocio.
El control diario aún tiene trabajo de cálculo en su primera apertura.

Para repetir las mediciones, preparar un checkout de la referencia y ejecutar,
sin otras pruebas de navegador en paralelo:

```sh
node tests/click-benchmark.cjs /ruta/a/referencia click-baseline
node tests/excel-benchmark.cjs /ruta/a/referencia click-baseline
node tests/click-benchmark.cjs . click-current
node tests/excel-benchmark.cjs . click-current
```

Los JSON se guardan en `work/test-results`. La referencia debe incluir sus
archivos originales `tests/server.cjs` y `tests/benchmark.cjs`.

## Actualización de la página

Publicar el conjunto del repositorio en GitHub Pages. `index.html`,
`pos-offline.js`, `service-worker.js` y `libs/app-tailwind.css` deben corresponder
a esta versión; las dos bibliotecas PDF eliminadas no deben volver al precache.
El CSS incluido ya está compilado y esta revisión no añade clases Tailwind.

Después de publicar, abrir la página con conexión y cerrar y volver a abrir
la aplicación para recibir la caché nueva. La actualización no requiere borrar
los datos del sitio, los registros locales ni las operaciones pendientes.
