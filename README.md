# MINIMARKET EL ERIZO

Versión de TiendaSmart preparada para GitHub Pages.
El archivo de entrada es `index.html` y las dependencias usan rutas relativas.

Los reportes se exportan exclusivamente a Excel. Se retiraron el botón, el
exportador PDF y las bibliotecas que utilizaba. El respaldo JSON se conserva.
El Centro de sincronización muestra espera, envío, errores, reintentos,
confirmaciones verificadas y conflictos pendientes de revisión.

La lógica principal permanece dentro del HTML. `pos-offline.js` conserva la base
IndexedDB existente y añade guardado incremental y transacciones de estado + cola.
Las bibliotecas siguen en `libs` y la PWA las conserva para uso sin conexión.

## Archivos que deben actualizarse juntos

- `index.html`
- `pos-offline.js`
- `service-worker.js`
- `libs/app-tailwind.css` (nuevo, sustituye la ejecución de Tailwind en el navegador)

Los demás archivos, incluidos los logotipos y bibliotecas, deben conservarse.
En esta actualización se eliminan `libs/html2canvas-1.4.1.min.js` y
`libs/jspdf-2.5.1.umd.min.js`. El Service Worker v6 deja de incluirlos en la caché.
No es necesario instalar Node ni ejecutar una compilación para publicar esta copia:
el CSS ya está generado. No borrar los datos del sitio ni desinstalar la PWA.
Antes de actualizar una caja real, exportar su respaldo JSON desde Sincronización.

## Desarrollo y pruebas

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run benchmark
```

Las pruebas inician su propio servidor en un puerto local disponible, usan
perfiles de navegador desechables y bloquean las solicitudes externas. Firebase
se prueba con dobles locales; no se usan datos ni credenciales de producción.
Los resultados se escriben en `work/test-results`.
Si Chromium ya está instalado en `/usr/bin/chromium`, las pruebas lo usan.
Puede indicarse otro ejecutable con `CHROMIUM_PATH`.

```sh
npm run preview
# Abrir http://127.0.0.1:8765/tienda-smart/
```

Después de editar clases de Tailwind dentro del HTML, ejecutar `npm run build:css`
y guardar también `libs/app-tailwind.css`. La configuración analiza el HTML completo,
incluidas las cadenas JavaScript con clases dinámicas literales.

## Diagnóstico voluntario

Abrir la aplicación con `?diagnostics=1` y consultar `TiendaPerf.report()` en la
consola del navegador. Registra inicio, renderizados, búsqueda, ventanas, guardado,
sincronización y tareas largas. Conserva hasta 500 muestras en memoria; no envía
telemetría ni guarda datos del negocio. Sin ese parámetro no instala observadores.
El consumo de memoria sólo aparece si el navegador expone `performance.memory`.

La actualización actual se documenta en `docs/EXCEL-Y-SINCRONIZACION.md`.
La auditoría inicial y sus mediciones se conservan en `docs/AUDITORIA.md` como
evidencia histórica. Los objetivos de Android necesitan una prueba en el equipo real.
