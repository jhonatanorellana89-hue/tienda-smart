# Auditoría e implementación de rendimiento — TiendaSmart / MINIMARKET EL ERIZO

Fecha del informe: 9 de noviembre de 2026 (America/Lima). Repositorio base:
`jhonatanorellana89-hue/tienda-smart`, commit `4afbd2491073052db760cf4efc2e3430c467d875`.
Se conservó una copia íntegra antes de modificarlo y una etiqueta local
`respaldo-antes-optimizacion-20261110` (fecha técnica UTC).

## Alcance y conservación

Se mantiene el programa dentro de `index.html`, su identidad naranja/blanca, el
logotipo, los 183 identificadores HTML originales, las rutas Firebase y las
bibliotecas locales. No se cambian frameworks ni se divide la lógica principal en
módulos. Sólo se añade CSS ya compilado y archivos de desarrollo, pruebas e informe.
Se modifican también los auxiliares existentes `pos-offline.js` y `service-worker.js`.

No se conectó al Firebase real durante la auditoría. Las pruebas usan perfiles de
Chromium desechables, datos sintéticos y un servidor HTTP local. Las solicitudes
externas de las pruebas se bloquean; no se modificaron precios, stock, usuarios,
saldos ni historiales reales. No se realizó despliegue ni fusión a `main`.

## Evidencia y método

Se midió la copia original antes de editar (`mediciones/baseline-metrics.json`).
Después se realizaron tres series adicionales de ambas versiones, una detrás de
otra, sin ejecutar otras pruebas a la vez. Se guardan todas las muestras. La tabla
usa medianas; no elimina resultados desfavorables. Cada escenario contiene
100/1.000/5.000 productos, 10.000 ventas, 5.000 movimientos, 500 clientes, 10 personas
y 40 turnos. Los datos de ventas y movimientos se conservan completos.

Entorno: Chromium 156.0.8078.79 en Linux de contenedor, viewport 412 × 915, CPU ralentizada
4 veces mediante Chrome DevTools Protocol, sin Service Worker en el microbenchmark.
Los perfiles son nuevos por catálogo; el navegador se reutiliza dentro de cada
serie de tres tamaños. Los módulos remotos se bloquean y el modo es sólo local.
El navegador del laboratorio utiliza la zona horaria del entorno (UTC).

Se utilizan Performance API, PerformanceObserver para tareas largas, Resource
Timing y trazas de `devtools.timeline` mediante Chrome DevTools Protocol. La traza
de diagnóstico es una muestra independiente, no una media estadística. Las
duraciones de función no equivalen al tiempo completo hasta pintar en pantalla.
El inicio incluye la espera del harness por `load` y los controles preparados.
La apertura visual de un modal se aproxima mediante el siguiente frame y una
tarea posterior; no mide una pantalla física Android.

Estos resultados no prueban el objetivo de menos de dos segundos en un teléfono
real ni garantizan límites de 100/150 ms en todos los dispositivos.

## Comparación medida

Tiempos en milisegundos; medianas de tres ejecuciones. La búsqueda reúne siete
consultas por ejecución. El inventario original crea todas las filas y la nueva
vista crea como máximo 80 por página; todos los productos siguen disponibles.

| Productos | Medición | Original ms | Optimizado ms |
|---:|---|---:|---:|
| 100 | Inicio local hasta controles preparados | 1331.0 | 509.7 |
| 100 | Ejecución de renderInventoryList | 5.7 | 7.3 |
| 100 | Búsqueda flexible (mediana) | 0.2 | 0.1 |
| 100 | Solicitud de respaldo (coste síncrono) | 161.0 | 0.3 |
| 100 | flushState de estado ya guardado | 1965.4 | 33.9 |
| 100 | Cálculo + render del modal Turnos | 110.0 | 49.7 |
| 1,000 | Inicio local hasta controles preparados | 1354.2 | 538.7 |
| 1,000 | Ejecución de renderInventoryList | 28.6 | 15.4 |
| 1,000 | Búsqueda flexible (mediana) | 4.8 | 1.6 |
| 1,000 | Solicitud de respaldo (coste síncrono) | 165.6 | 0.9 |
| 1,000 | flushState de estado ya guardado | 1977.3 | 46.4 |
| 1,000 | Cálculo + render del modal Turnos | 266.8 | 52.4 |
| 5,000 | Inicio local hasta controles preparados | 3279.0 | 696.3 |
| 5,000 | Ejecución de renderInventoryList | 125.7 | 41.5 |
| 5,000 | Búsqueda flexible (mediana) | 23.3 | 5.5 |
| 5,000 | Solicitud de respaldo (coste síncrono) | 131.7 | 1.1 |
| 5,000 | flushState de estado ya guardado | 2619.9 | 52.0 |
| 5,000 | Cálculo + render del modal Turnos | 826.3 | 77.5 |

`flushState` mide el caso de un estado ya guardado, muy relevante para los
respaldos repetidos que motivaron este trabajo. No debe interpretarse como una
garantía de duración de cualquier venta nueva. El guardado crítico real se verifica
funcionalmente con ventas, compras, fallos de almacenamiento y recargas.
Con 100 productos la paginación introduce un pequeño coste fijo en el renderizado;
la mejora aparece al crecer el catálogo. El coste de `JSON.stringify(STATE)` no
desaparece: se mide por separado en los JSON adjuntos.

Las dependencias y recursos secundarios iniciales pasan de unos 3,98 MB a 1,49 MB
sin contar el documento HTML principal. La caché PWA sigue descargando las
bibliotecas auxiliares para permitir usarlas sin red; diferir su ejecución no
implica eliminarlas del paquete ni de la instalación offline.

El perfil original reproduce **50 listeners de visualViewport retenidos** tras
50 ciclos de abrir dos veces y cerrar una ventana. La versión optimizada retiene
**0**. La comparación de estilos calculados de la pantalla inicial, incluidos sus
elementos ocultos, arroja **0 diferencias** después de conservar el orden de CSS.
No es una comparación visual exhaustiva de todos los estados de todos los modales.

## Carga y ejecución de bibliotecas

Muestra independiente de duración `EvaluateScript` en la traza CDP, CPU ×4. Son
tiempos de evaluación observados, no todo el coste posterior de una biblioteca.
Lucide sigue siendo esencial y su variación entre muestras no se presenta como
una mejora. Los recursos y duraciones completos están en `profiling-results.json`.

| Biblioteca | Evaluación original ms | Inicio optimizado |
|---|---:|---|
| tailwindcss-3.4.17.js | 252.5 | Diferida / CSS precompilado |
| lucide-0.468.0.min.js | 93.2 | 132.6 |
| xlsx.full.min.js | 201.4 | Diferida / CSS precompilado |
| html2canvas-1.4.1.min.js | 17.7 | Diferida / CSS precompilado |
| jspdf-2.5.1.umd.min.js | 95.8 | Diferida / CSS precompilado |
| quagga2-1.8.4.min.js | 24.6 | Diferida / CSS precompilado |
| firebase-app-9.22.2-compat.js | 3.3 | Diferida / CSS precompilado |
| firebase-auth-9.22.2-compat.js | 43.2 | Diferida / CSS precompilado |
| firebase-firestore-9.22.2-compat.js | 19.8 | Diferida / CSS precompilado |

El navegador ya no ejecuta el compilador Tailwind en producción. Su sustituto se
genera con Tailwind 3.4.17 a partir de todo el HTML, incluidas las cadenas de clases
en JavaScript. El CSS se coloca después de los estilos propios para mantener la
cascada original. Si en futuras modificaciones se construyen nombres de clase por
concatenación, deberán declararse completos o añadirse a la lista de clases seguras.

## Cambios por función y cuello de botella

| Funciones o flujo | Evidencia y cambio implementado |
|---|---|
| `startApp`, `registerPWA` | El `await bootstrapCloudSync(false)` retrasaba los enlaces de búsqueda y escáner. Ahora los controles locales se preparan primero y la nube empieza después de una oportunidad de pintado. Registro PWA único por página; sin `update()` duplicado. |
| `initializeLocalPersistence`, `tryRecoverStateFromLocalStorage` | Se evita serializar/regrabar el estado durante cada inicio y escanear todos los respaldos cuando IndexedDB ya es válido. Un respaldo antiguo con más registros deja de sustituir al almacén actual. Se conservan lectura legacy y recuperación alternativa. |
| `ensureStateShape` | Normaliza objetos nuevos con WeakSet y evita repetir la normalización completa de los mismos registros y la reconstrucción de stock en cada uso. |
| `renderAll`, `renderDashboard` | Se actualizan las vistas visibles y se evita reconstruir stock como efecto de pintar. Los cálculos del dashboard siguen siendo lineales cuando se solicitan. |
| `renderInventoryList`, `getProductById`, `getLinkedChildrenByParentId` | Página de 80 registros, reutilización de filas por ID y firma, mapas de productos y vínculos, índices normalizados e invalidación en límites de mutación. No se limita ni elimina el inventario almacenado. |
| `rebuildLinkedStocks`, `getAvailableQtyForSale` | Se mantienen factores, redondeos y cantidades del algoritmo original. La reconstrucción se reserva para normalización y cambios de datos. Se corrige el caso comprobado de un cero remoto que antes podía reconstruirse desde un hijo antiguo. |
| `getPosMatches`, `setupPosSearch`, `scannerFindProductByCode` | Índices normalizados reutilizables, ranking estable equivalente al original, ocho resultados, debounce de 60 ms al escribir y cancelación de la consulta pendiente al pulsar Enter. Índice exacto y alias UPC/EAN con ceros iniciales; escaneo sin debounce de búsqueda. |
| `renderCart` | Se reutiliza la fila del producto y se actualizan cantidades/subtotales sin destruir el campo que se está editando. Los totales mantienen el cálculo existente. |
| `renderClients`, `renderGestionList` | Paginación de 80 filas; Gestión puede acceder a todo el historial en vez de cortar la vista a 500 ventas. No se recorta el historial real. |
| Reportes, compras, control diario | Previsualizaciones paginadas de 80 filas. Resúmenes, cierres y exportaciones conservan el conjunto completo. Los conteos físicos se mantienen al cambiar de página. Mapas sustituyen búsquedas repetidas por producto y se reutilizan cálculos por raíz del día. |
| `saveLocalBackup`, `scheduleMergedStateBackup`, `savePending`, `POSStorage` | Se elimina la clonación inmediata de todo el estado en cada llamada y el `clear()` de todos los almacenes en cada respaldo. Se detectan filas cambiadas y se escriben sólo esas filas en transacciones serializadas. El temporizador no guarda si no hay cambios. |
| `completeSale`, ingreso, productos, clientes y personal | Guardas contra doble envío y confirmación durable antes de mostrar éxito. Ventas y compras guardan estado y cola juntos. Si fallan ambos almacenes, se revierte la mutación y se conserva el formulario/carrito. |
| `queueUnsentAuditLogs` | Un Set evita buscar toda la cola por cada registro. Se elimina el recorte previo a 5.000 auditorías: el historial queda conservado. |
| `openModal`, `closeModal`, `switchTab` | Ventana visible antes de tareas secundarias, apertura repetida idempotente, cancelación de tareas diferidas, baja de listeners de resize/scroll y limpieza de transformaciones. Los cambios de pestaña obsoletos no ejecutan renderizados pendientes. |
| `openShiftModal`, `renderShiftModal`, `updateShiftUI` | Apertura local, personal disponible sin esperar red, campos/PIN/notas conservados durante refrescos y sin reemplazar el borrador por datos remotos. |
| `loadPersonnelForLoginFromCloud`, `calculateShiftSummary` | Consulta compartida con caché de 60 s; se reutilizan las suscripciones activas. Índice de ventas por turno y caché de resúmenes invalidada al guardar/mezclar. Se mantienen PIN, sesión, permisos, diferencias y cierre offline. |
| `bootstrapCloudSync`, `startFirestoreSync` | Promesas compartidas y generaciones para impedir escuchadores duplicados. Se elimina el `get()` completo de once colecciones previo a escuchar esas mismas colecciones. La primera instantánea sigue incluyendo su historia completa. |
| `mergeFromSubcollection`, `mergeState` | `docChanges()` procesa cambios, con lotes de hasta 200 documentos por tarea. Se evita clonar/mezclar todas las colecciones por un documento. Se protegen entidades con operaciones locales pendientes y se conservan tombstones e historia. |
| `processPendingOps`, `updateOnline` | Se rompe el ciclo de reintentos entre el indicador y la cola. Se espera confirmación de escritura, se respeta backoff y se preserva el orden por entidad. Un snapshot no retira operaciones ni cambia la fecha de última escritura confirmada. Los indicadores se agrupan. |
| `safeCreateIcons` | Sólo se convierten marcadores `<i>` nuevos; los SVG ya procesados no se vuelven a crear globalmente. |
| Escáner de cámara | Carga local diferida de Quagga, cancelación de inicios obsoletos y liberación de tracks al cerrar o enviar la app al fondo. Se prueba con cámara sintética de Chromium. |
| Service Worker | Caché versionada v5, navegación desde caché con actualización de fondo, comprobación de respuesta HTML válida y limpieza sólo de cachés propias. |

## Persistencia y recuperación

La base sigue llamándose `TiendaSmartOffline`, versión 3, con los mismos almacenes.
Se añade metadato `entityStateV1` para leer entidades incrementales en su orden
original. La instantánea legacy de `snapshots/current` se conserva sin destruirla;
no es la instantánea que se actualiza con cada operación nueva. Los respaldos
localStorage anteriores tampoco se eliminan.

Una venta/compra confirmada debe completar una transacción de estado y cola. Si
IndexedDB falla, se intenta un único `localStorage.setItem` con un sobre que contiene
ambos; si también falla, no se anuncia éxito. Ese sobre se reimporta al reiniciar y
se retira sólo después de persistirlo. Una cola anterior de localStorage no vuelve
a introducir operaciones ya retiradas del almacén actual.

El ZIP original es un respaldo del código, no de los datos de una caja real.
Antes de cambiar una instalación o restaurar código antiguo, exportar su JSON
actual desde Sincronización. No borrar IndexedDB, localStorage ni datos de la PWA.
Volver únicamente al código anterior no convierte automáticamente el nuevo
manifiesto incremental al formato de instantánea que leía aquel código: debe
conservarse la versión optimizada para leer los datos recientes o restaurarlos
desde el JSON mediante una intervención revisada. No se añade una interfaz nueva
de importación/restauración masiva en este trabajo.

## Verificación funcional

Resultado: **40 pruebas aprobadas**, sin errores `pageerror` de JavaScript.
`npm run check` compila los scripts, comprueba 96 manejadores HTML, los 183 IDs y
los recursos locales referenciados. El navegador también parsea el HTML al cargar.
No se presenta esto como una validación normativa exhaustiva de HTML.

Los JSON de resultados enumeran cada caso. Incluyen:

- 50 ciclos de apertura/cierre y aperturas repetidas, cancelación de tareas y listeners.
- Búsqueda flexible comparada con el algoritmo original y escaneo con ceros iniciales.
- Catálogo paginado, filas reutilizadas, invalidación de índices y carrito con foco conservado.
- Productos vinculados, factores y redondeos; cero remoto sin resurrección de stock.
- PIN inválido/válido, apertura local, cierre y conciliación exacta.
- Venta offline, compra offline, doble envío, cinco ventas consecutivas y recarga con cola.
- Registro doble de producto, cliente y personal, con hash de PIN mediante el algoritmo existente.
- Fallo de ambos almacenes, aborto transaccional, reversión y respaldo alternativo recuperable.
- Migración v3 sin borrar la instantánea y sin resucitar respaldos/colas antiguos.
- Suscripción única por colección, snapshots parciales, datos locales protegidos y confirmación explícita.
- Backoff y orden de escrituras por entidad; Firebase bloqueado sin bloquear el inicio local.
- Precarga PWA, recarga offline, Excel/PDF diferidos y archivos exportados válidos.
- Cinco ciclos de cámara sintética y cancelación al cerrar mientras se inicia.
- Paginación de reportes/conteos conservando totales y borradores.
- Diagnóstico desactivado por defecto y activación voluntaria.

## Límites y asuntos pendientes

1. No se probó un Android físico, su teclado real, suspensión del proceso por el
   sistema, escáner/cámara comercial, ni cambio de fondo/primer plano bajo presión
   real de memoria. Se cubren eventos y streams sintéticos, no ese hardware.
2. Firestore real, reglas de acceso, facturación de lecturas y dos cajas vendiendo
   simultáneamente requieren validación en un entorno de pruebas autorizado. Los
   casos de reconexión, error y confirmación usan dobles locales. No se afirma que
   la app original posea transacciones de stock entre dispositivos: las rutas y
   escrituras absolutas existentes se conservan y ese problema no se resuelve sólo
   con optimización de interfaz.
3. La primera suscripción sigue leyendo el historial completo. No se aplican límites
   remotos ni se eliminan documentos para mejorar cifras. La consulta de resolución
   de la colección y la comprobación/migración legacy siguen existiendo. No hay una
   medición real de ahorro de lecturas Firebase.
4. La detección incremental de persistencia recorre/serializa cada fila cuando hay
   cambios. Reduce escrituras y copias, pero conserva coste lineal y un índice de
   firmas en memoria. La primera carga/migración muy grande y algunas tareas de
   diagnóstico todavía producen tareas de más de 50 ms; no se garantiza su ausencia.
5. Exportar historiales muy grandes sigue siendo una tarea explícita costosa. El PDF
   conserva el método original: captura completa y escalado a una página. Se probó
   un PDF pequeño válido; no se verificó un PDF de 10.000 ventas. El límite de canvas
   del navegador puede impedirlo o hacerlo poco legible. Resolver esa limitación
   requiere cambiar el generador de PDF a varias páginas en otro cambio.
6. La latencia de botones medida se refiere al modal simple de sincronización y a
   las funciones indicadas. No equivale a una medición individual de cada botón
   secundario o combinación de datos heredados.
7. Se conserva la validación de sesión, PIN y claves existente; no se revisaron reglas
   Firebase remotas ni se rediseñó el modelo de autenticación local. Las garantías
   de almacenamiento también dependen de que el usuario no borre datos del sitio.

## Reproducir y revisar

`npm ci`, `npx playwright install chromium`, `npm run check`, `npm test` y
`npm run benchmark`. Los resultados nuevos quedan en `work/test-results`.
El benchmark se puede ejecutar contra la copia original restaurada en el servidor
de laboratorio para comparar con las muestras conservadas. El archivo
`tests/reference-search.js` es sólo la función original de referencia para pruebas.

Para diagnóstico real: abrir `?diagnostics=1`, reproducir el problema y consultar
`TiendaPerf.report()`. Está desactivado por defecto, acota muestras y no transmite
datos. Las trazas CDP originales se entregan en el paquete de evidencias de auditoría.
