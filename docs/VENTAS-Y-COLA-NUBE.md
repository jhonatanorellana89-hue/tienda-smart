# Ventas recientes y envío de colas grandes

Esta actualización reduce el tiempo que tarda una venta en salir de una cola
grande y aparecer en otro equipo. Conserva los registros, sus IDs, el cálculo
de stock y saldos, los permisos y las rutas de Firebase existentes.

## Cambios

- Se envían hasta 100 operaciones compatibles por lote, con límites de 450
  escrituras y un presupuesto conservador de tamaño. Las compras conservan su
  conjunto atómico. Las operaciones sobre el mismo registro mantienen el orden;
  las ventas a crédito esperan las actualizaciones anteriores de su cliente.
- Las ventas independientes tienen prioridad sobre auditorías pendientes y las
  ventas nuevas sobre ventas antiguas de otros IDs. Los registros que comparten
  entidad no se adelantan entre sí.
- Si un lote es rechazado por un registro, se prueban las operaciones de forma
  individual con hasta cuatro envíos simultáneos. Así se conserva el error
  concreto sin retener las ventas independientes. Los errores transitorios
  conservan su espera de reintento.
- Una confirmación que no llega en veinte segundos deja de bloquear todo el
  recorrido. Se conserva el envío en curso, se reactiva la conexión y pueden
  avanzar otras operaciones independientes. El mismo envío no se repite mientras
  su promesa siga pendiente. Hay un límite de 200 operaciones en ese estado.
- Una respuesta tardía sólo confirma el objeto que se envió. Si el contenido
  de un ID cambió mientras se enviaba, la versión nueva permanece pendiente.
- La confirmación local elimina únicamente los IDs aceptados y guarda sus
  recibos en la misma transacción IndexedDB. No vuelve a serializar toda la cola
  por cada venta. Si falla ese guardado, se conserva la cola y la prueba de nube;
  al reintentar se guarda el recibo sin repetir la escritura confirmada.
- El recorrido incorpora operaciones que llegan durante el envío y revisa las
  pendientes aunque una suscripción de datos todavía no esté al día.
- Se instala primero una consulta de las 80 ventas recientes. La lectura completa
  del archivo comienza después de la primera respuesta del servidor o, como
  respaldo, tras un segundo. El historial completo sigue teniendo escucha y los
  cambios antiguos se incorporan; salir del límite de la consulta rápida no borra
  una venta.
- Gestión abre en la primera página, ordena por fecha y muestra 40 ventas por
  página. Incluye la cantidad pendiente de confirmación y «Ver envíos».
- Las fechas Timestamp antiguas de Firestore también se interpretan para mostrar
  y contabilizar las ventas. La normalización se aplica a la copia local.
- La PWA v9 incorpora la corrección de descarga de recursos que había quedado
  pendiente: el precache utiliza `cache: reload` para recibir el módulo de
  guardado actualizado aun si el archivo HTTP anterior seguía fresco.

## Verificación

Se conservan las 90 comprobaciones anteriores y se añaden 12: lotes de 1.200
operaciones, equivalencia de payloads, prioridad de ventas, orden por entidad y
cliente, aislamiento de errores, recibo local fallido, confirmación tardía,
actualización del mismo ID durante envío, consulta de ventas recientes, réplica
entre dos perfiles de navegador, fechas Timestamp y compras de 450 escrituras.

`npm run check` valida sintaxis, recursos e identificadores originales.
Las 102 comprobaciones usan datos sintéticos y bloquean solicitudes externas.
La réplica entre perfiles simula la entrega confirmada por Firebase; no utiliza
ni modifica ventas reales del negocio. Se conserva el funcionamiento offline,
el respaldo JSON y la exportación exclusiva de reportes a Excel.

Resultados: [`mediciones-ventas`](./mediciones-ventas/).

## Comparación controlada

Referencia: `831f4e0d1127f3a2597c89ca7ae87ba6050c65a5`, la versión publicada al
iniciar esta revisión. Chromium 156, viewport 412 × 915, 1.000 ventas pendientes
y una confirmación simulada de 10 ms por solicitud.

| Medida | Referencia | Actualización |
| --- | ---: | ---: |
| Solicitudes para las 1.000 ventas | 1.000 | 10 |
| Tiempo hasta enviar la venta más reciente | 12.995 ms | 109 ms |
| Tiempo total para confirmar y retirar la cola | 12.997 ms | 353 ms |
| Ventas confirmadas / operaciones restantes | 1.000 / 0 | 1.000 / 0 |

Esta prueba demuestra el efecto del recorrido y sus esperas; no mide la red ni
los límites del proyecto Firebase real. No garantiza esos tiempos en el celular.
La escucha rápida añade una consulta acotada a las consultas existentes.

```sh
node tests/sales-throughput.cjs /ruta/a/referencia sales-baseline
node tests/sales-throughput.cjs . sales-current
```

## Uso y actualización

Publicar juntos `index.html`, `pos-offline.js` y `service-worker.js`.
El esquema IndexedDB v3 y sus registros se conservan. El modo Automático y una
conexión efectiva a Internet son necesarios para subir los datos. Mantener la
app abierta permite completar la cola; el navegador del celular puede suspender
el trabajo cuando la app queda cerrada o en segundo plano.

Si aún aparece el aviso de guardado local, descargar el respaldo JSON desde
Sincronización antes de cerrar o recargar. Después abrir con Internet para recibir
la actualización. Conservar los datos del sitio.
