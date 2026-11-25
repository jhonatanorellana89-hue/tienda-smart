# Conexión a nube y recuperación del guardado local

Esta revisión atiende dos síntomas: «Esperando respuesta de la nube» durante
mucho tiempo y avisos repetidos de que no se confirmó el guardado local.

## Conexión

El inicio anterior comprobaba productos, clientes y ventas; después esperaba
otra lectura del documento antiguo. Antes de instalar las once suscripciones
volvía a comprobar la migración. Una lectura antigua lenta podía retrasar toda
la conexión aunque los productos ya hubieran respondido.

Ahora:

- Las dos rutas existentes se comprueban en paralelo con lecturas pequeñas
  del servidor. La primera respuesta positiva de la ruta principal permite
  continuar. Sólo se elige la alternativa si la principal se verificó vacía;
  un error de permisos o una espera no cambian la base de datos.
- La ruta verificada se recuerda para el mismo proyecto, tienda y configuración.
  Las siguientes aperturas evitan buscarla otra vez. Si no puede guardarse ese
  indicador secundario, se conserva la verificación en memoria.
- Se instala la escucha antes de esperar una posible migración antigua. Los
  envíos permanecen retenidos hasta verificar la ruta y preparar los datos.
  Hay un solo trabajo de preparación; un reintento no duplica la migración.
- El módulo base de Firebase se carga primero; Auth y Firestore se cargan en
  paralelo después. Se conservan la autenticación y las rutas existentes.
  Firestore utiliza detección automática de long polling sin fetch streams.
- La espera de inicio tiene un presupuesto de seis segundos. Si vence, la
  aplicación muestra el problema y reintenta; las lecturas originales se
  comparten mientras sigan pendientes. No inventa una ruta ni confirma envíos.
- Las suscripciones fallidas por errores temporales se recuperan con esperas
  de 2, 4, 8, 16 y hasta 30 segundos. Los rechazos de permisos quedan visibles
  y no provocan reintentos continuos.
- Volver a la app o recuperar Internet reactiva la red. Si sólo llegan datos
  de caché durante diez segundos, se programa recuperación del transporte,
  con un intervalo mínimo de treinta segundos entre reinicios. Se conservan
  las suscripciones, los registros locales y los IDs de las operaciones.
- «Conectado · Actualizando datos» distingue una respuesta real de nube de la
  actualización completa. «Al día» exige preparación completa, todas las
  colecciones actualizadas y ninguna operación pendiente. Las confirmaciones
  de escritura siguen guardándose junto con la retirada de la cola.

## Guardado local

Se reprodujo un caso concreto del aviso: una conexión IndexedDB cerrada seguía
guardada en memoria. Los siguientes intentos reutilizaban ese objeto inválido;
si el respaldo de localStorage tampoco cabía, aparecía el aviso general.
La captura del usuario no permite saber por sí sola si ésa es la causa de su
dispositivo, si falta espacio o si el navegador bloquea el almacenamiento.

La corrección escucha el cierre de IndexedDB y reabre una conexión válida.
Si una escritura encuentra `InvalidStateError` o `TransactionInactiveError`,
reabre y reintenta una sola vez. Conserva las firmas de la última transacción
confirmada para que los registros eliminados no reaparezcan. Una apertura
bloqueada deja de conservar una promesa rechazada y cierra cualquier conexión
que llegue después de ese rechazo.

Los fallos de las escrituras programadas de cola llegan al indicador de la app.
Si fallan la base y el respaldo alternativo, se conservan ambos errores para
mostrar la causa, el estado sigue pendiente y no se avanza la revisión guardada.
Se muestra un aviso a la vez, con un mínimo de treinta segundos entre avisos,
y un estado persistente «Guardado local pendiente». Hay reintento automático
y un botón «Reintentar guardado» en Sincronización.

Un dispositivo sin espacio o un navegador que deniega el almacenamiento puede
seguir impidiendo grabar. La app mantiene el aviso y permite descargar el
respaldo JSON desde memoria; no presenta una venta como guardada si fallan los
dos almacenes. Esta actualización no elimina registros, cachés de datos ni
respaldos históricos para conseguir espacio.

## Verificación

`npm run check`: sintaxis, recursos e identificadores originales correctos.
`npm test`: 90 comprobaciones, incluidas las 67 anteriores, 16 de conexión y
6 de recuperación del almacenamiento y una de actualización de caché. Se cubren el SDK real incluido,
rutas principal y alternativa, permisos, esperas, reconexión, migración lenta,
IDs y recibos, cierre de IndexedDB, apertura bloqueada, errores de cuota,
avisos repetidos, recuperación automática y permanencia del respaldo JSON.
Las pruebas usan perfiles desechables, datos sintéticos y conexiones de nube
simuladas. Las solicitudes externas se bloquean; no se leen ni modifican los
datos de Firebase del negocio. El SDK real se verifica sin consultas de nube.

Evidencia: [`mediciones-nube-guardado`](./mediciones-nube-guardado/).

### Comparación controlada

`tests/cloud-benchmark.cjs` compara la revisión anterior `35b7a1f` con la nueva
usando respuestas simuladas: 200 ms para las colecciones y 2.000 ms para el
documento antiguo. El tiempo hasta instalar las once suscripciones pasó de
aproximadamente 4.203 ms a 204 ms en la primera apertura, y de 4.201 ms a menos
de 1 ms al reabrir. Las lecturas de búsqueda pasaron de cinco en cada apertura
a ocho pequeñas lecturas paralelas iniciales y cero en las siguientes.

Esto demuestra que se retiraron esperas del programa; no mide la velocidad de
Internet ni garantiza que el servidor real responda en esos tiempos.

```sh
node tests/cloud-benchmark.cjs /ruta/a/referencia cloud-baseline
node tests/cloud-benchmark.cjs . cloud-current
```

## Actualización

Publicar juntos `index.html`, `pos-offline.js` y `service-worker.js`.
El Service Worker v8 renueva los recursos de la aplicación y mantiene el esquema
IndexedDB v3. No cambian las bibliotecas de Excel ni el retiro de PDF.

Si el aviso de guardado sigue presente en la versión abierta, descargar primero
el respaldo JSON desde Sincronización, antes de recargar o cerrar la app.
Después, abrir con Internet para recibir la actualización. No borrar los datos
del sitio ni desinstalar la PWA como método de reparación.

### Entrega de recursos nuevos a la PWA

Se reprodujo una segunda causa de actualización incompleta: el precache podía
reutilizar `pos-offline.js` desde una caché HTTP todavía fresca y conservar el
módulo anterior. La instalación ahora solicita los recursos con `cache: reload`
y utiliza `tiendasmart-github-v8-refresh`. Una prueba con caché HTTP real verifica
la descarga del módulo nuevo, su presencia en Cache Storage y su ejecución tras
recargar completamente sin Internet. El esquema y los datos IndexedDB se conservan.
