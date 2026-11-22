# Excel y sincronización más clara

Esta actualización responde a la solicitud de retirar PDF y mejorar la información
de sincronización. Se mantiene el HTML principal, la identidad gráfica, los
identificadores anteriores, las reglas de venta y las rutas de Firebase. Se trabaja
en la misma propuesta de revisión de GitHub; no implica desplegar la aplicación.

## Reportes en Excel

Se eliminan el botón de exportación PDF, `downloadReportPDF()`, `ensurePDFLoaded()`
y la construcción de un reporte completo en el DOM que sólo se usaba para capturar
ese PDF. Se retiran del proyecto y de la precarga PWA:

- `libs/html2canvas-1.4.1.min.js` (198.689 bytes).
- `libs/jspdf-2.5.1.umd.min.js` (364.463 bytes).

Son 563.152 bytes de bibliotecas eliminadas. Como ya se cargaban de forma diferida,
esto reduce el paquete y la instalación offline; no se presenta como una nueva
medición de aceleración del inicio. Los reportes de Excel siguen usando los datos
completos, independientemente de la página visible en la interfaz. Se comprueba
una exportación real de 5.000 productos y la conservación de los ceros de códigos.

Los reportes de ventas, inventario y libro combinado continúan disponibles en
Excel. El respaldo JSON se conserva para recuperación; no es un reporte PDF.
Los archivos y trazas de la auditoría anterior son evidencia histórica, no código
PDF activo. El punto de restauración anterior se conserva en Git.

## Centro de sincronización

El botón SYNC abre el centro de información. El panel muestra:

- Estado general con explicación de lo que falta por hacer.
- Total en cola y contadores separados de espera, envío activo y error.
- Lista paginada de 20 operaciones, con tipo, referencia, ID, fecha, intento y error.
- Filtro de errores y reintento de una operación o del conjunto con error.
- Las últimas 20 confirmaciones registradas en este equipo, conservadas al recargar.
- Conflictos de stock y de turno con explicaciones específicas, sin resolverlos
  automáticamente ni cambiar cantidades al mostrarlos.

Los controles de envío y respaldo están cerca del resumen. En modo local o sin red
los botones de envío aparecen deshabilitados. Las ventas pueden continuar mientras
se envía la cola. Los refrescos visuales se agrupan para evitar reconstrucciones
repetidas por cambios de metadatos de Firebase.

| Estado visible | Qué significa |
|---|---|
| Solo en este equipo | El modo automático está pausado; los registros quedan guardados localmente. |
| Sin Internet | La cola permanece guardada y se reintentará al recuperar conexión. |
| Preparando envío | Se verifica el guardado local antes de enviar. |
| Enviando operaciones | Existe un envío o guardado de su recibo en curso. |
| Cambios pendientes de envío | Hay registros todavía sin confirmación completa. |
| Hay operaciones por revisar | Una operación falló y sigue en la cola. |
| Esperando respuesta de la nube | La conexión todavía no se verificó o sólo hay datos de caché. |
| Actualización incompleta | Al menos una suscripción de datos falló. |
| Actualizando datos / desde la nube | Se incorporan cambios recibidos o se realiza una lectura manual. |
| Revisión pendiente | Los envíos terminaron, pero queda un conflicto abierto. |
| Al día | No hay cola ni conflictos y todas las suscripciones dieron datos del servidor. |

Una operación heredada con estado `processing` no se muestra como un envío activo
si todavía no existe un envío de esta instancia. Al reconectar se invalida la
verificación anterior de conexión hasta recibir nuevos metadatos del servidor.
Recibir datos de caché o un `onSnapshot` no crea una confirmación de escritura.

## Confirmaciones y conservación de la cola

Una confirmación se crea únicamente después de que la escritura remota resuelve
correctamente. La retirada de la operación y su recibo se guardan en una misma
transacción IndexedDB. Se usa el almacén `meta` existente; no cambia el nombre,
versión ni estructura de almacenes de la base, ni se crean colecciones en Firebase.

Si falla el guardado del recibo, se conserva la operación en la cola. El panel
explica que la escritura está confirmada en nube y que falta el recibo local.
Mientras la confirmación sea conocida en esa instancia, reintentar completa el
recibo sin repetir la escritura remota. Si la app se cierra antes de persistir esa
prueba, se conserva la operación original y se reenvía con el mismo identificador,
manteniendo la idempotencia existente.

Si se reemplaza el contenido de una operación con el mismo ID, se invalida la
confirmación del contenido anterior para que la versión nueva también se envíe.
Un recibo local tardío se ordena por su fecha de confirmación, sin hacer retroceder
la fecha de la confirmación más reciente.

El límite de 20 se aplica solamente a esta lista auxiliar de recibos. No recorta
ventas, compras, movimientos, auditorías ni operaciones pendientes. Los reintentos
conservan los IDs y el orden por entidad. La lectura avanzada desde la nube conserva
la cola, requiere la clave existente de Stock y está protegida contra doble ejecución.
Una lectura de datos no se muestra como confirmación de escritura.

## Verificación

Se ejecutan `npm run check` y `npm test`: **53 pruebas aprobadas**, sin errores de JavaScript en los escenarios probados. Los resultados detallados de esta versión
se conservan en `docs/mediciones-excel-sync/`. Incluyen las pruebas anteriores de
ventas, compras, turnos, conservación de datos y PWA, actualizadas para Excel, y
casos adicionales de estados de red, caché, snapshots, doble reintento, errores
locales de recibo, paginación, confirmaciones persistentes y Excel completo.

Los perfiles son desechables, los datos son sintéticos y las solicitudes externas
se bloquean. Las respuestas de Firebase se simulan. No se usaron datos reales de
producción ni se cambian saldos, cantidades o reglas de caja por razones de interfaz.
La pantalla se inspecciona también en un viewport móvil de 412 × 915.

No se repite la comparación histórica de tiempos: las cifras de la primera
auditoría pertenecen a aquella versión. Firebase real, Android físico, teclados y
cámaras comerciales continúan pendientes de validación en equipos representativos.

## Actualización de una instalación

Exportar primero el respaldo JSON desde la caja. Actualizar juntos `index.html`,
`pos-offline.js`, `service-worker.js` y `libs/app-tailwind.css`, y retirar las dos
bibliotecas PDF indicadas. El paquete completo de la rama ya contiene estos cambios.
El Service Worker v6 renueva su caché sin borrar IndexedDB ni los datos de ventas.
Cerrar y volver a abrir la aplicación después de instalar la actualización.
