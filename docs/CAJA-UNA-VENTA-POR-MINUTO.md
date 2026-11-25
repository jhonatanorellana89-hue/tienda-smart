# Caja con una venta por minuto: guardado y visualización local

El problema reportado ocurre en la misma caja que registra la venta. Esta
revisión concentra la mejora en guardar y mostrar la operación local, antes
de esperar la sincronización con Firebase.

## Cuellos de botella encontrados

`completeSale()` guardaba una transacción recorriendo todas las entidades de
`STATE`. Aunque IndexedDB escribía sólo las filas diferentes, para descubrirlas
serializaba cada venta y movimiento históricos. Una prueba con 5.000 productos,
100.000 ventas y 100.000 movimientos hizo unas 205.500 serializaciones por venta.
También se copiaba en profundidad el historial del producto para preparar un
posible rollback.

Después del guardado se actualizaban los contadores de Inicio, pero no había
un comprobante visible con el detalle de la última venta. Los reportes ya
abiertos tampoco se actualizaban directamente al terminar el cobro.

## Corrección

- El guardado de una venta incluye sólo productos afectados, la venta nueva,
  movimientos nuevos, el cliente si es crédito y las operaciones nuevas de cola.
  Todo se confirma dentro de la misma transacción IndexedDB.
- Los cambios recibidos de la nube también registran las filas afectadas para
  guardarlas de forma incremental. Un cambio general, una importación o un
  estado cuya base durable no se conoce conserva el guardado completo.
- Cada cambio tiene su propia referencia de seguimiento: una segunda modificación
  de la misma fila mientras se guarda la primera no se marca por error como
  persistida. Los registros históricos no se eliminan para conseguir velocidad.
- Se conserva IndexedDB v3. Una cabecera de orden acotada a 200 IDs por entidad
  permite restaurar los registros recientes y conservar el orden por fecha; un
  guardado completo vuelve a establecer el orden de referencia.
- El rollback de caja conserva únicamente la familia de productos modificada,
  el saldo afectado y las operaciones creadas por esa venta. No copia en
  profundidad todos los movimientos anteriores ni restaura envíos ajenos ya
  confirmados. Si falla el guardado, la venta nueva no queda como confirmada.
- Los índices de productos, ventas y resumen diario se reutilizan cuando sólo
  cambia el stock de la venta. El resumen mantiene el mismo orden de suma de
  las ventas del día. Las modificaciones generales invalidan las vistas.
- Se evita repetir un guardado completo de todo el historial justo antes de
  subir una venta que ya quedó guardada con su cola. Los envíos se programan
  después de permitir que se pinte la confirmación local.
- **Última venta guardada** muestra importe, productos, fecha, pago y estado de
  envío después de la confirmación durable local. Permanece visible en Inicio,
  Inventario y Reportes, con botones de Nueva venta y Ver ventas. Ver ventas
  conserva la validación de acceso existente; un usuario de personal no ve el
  comprobante de otro usuario.
- Los reportes abiertos se actualizan al completar el cobro, manteniendo sus
  fechas de filtro. La lista de ventas reutiliza su orden y no vuelve a convertir
  las fechas durante cada comparación de ordenamiento.
- El respaldo alternativo de estado y cola es autoritativo al recuperarse. Una
  operación ya retirada de ese respaldo no reaparece por mezclarse con una cola
  antigua de IndexedDB.

## Verificación

`npm run check` valida sintaxis, recursos e identificadores originales.
Pasaron 115 comprobaciones: se mantienen las 102 previas y se añaden 13 para esta revisión.

La simulación de 60 ventas, una por minuto, utiliza un reloj virtual para el
tiempo transcurrido y transacciones reales de IndexedDB. Se parte de 100.000
ventas históricas y se comprueban stock, crédito, pagos, turno, cola y el detalle
visible. Las ventas registradas son 20 en efectivo, 20 por Yape y 20 a crédito.
Ninguna serializa el registro histórico instrumentado para detectar recorridos
innecesarios.

Se comprueban además guardado lento y doble clic, fallo de los dos almacenes,
aborto en la escritura de metadatos, orden de más de 200 ventas nuevas, recarga,
cambios remotos simultáneos, reportes abiertos, filtros históricos, respaldo
alternativo, permisos, stock principal cero y cambios de precio. La aplicación
no presenta un comprobante nuevo antes de que el guardado local termine.

Las pruebas utilizan datos sintéticos y perfiles desechables; bloquean solicitudes
externas y no leen ni modifican registros del negocio en Firebase.
Evidencia: [`mediciones-caja-minuto`](./mediciones-caja-minuto/).

## Medición de rendimiento

Referencia: `4de67526982c1a980cb7926beb3cddf37409331f`, la versión publicada
al comenzar la revisión. Chromium 156, viewport 412 × 915, CPU ralentizada seis
veces. Escenarios de 10.000 y 100.000 ventas y movimientos históricos, 5.000
productos y 5.000 movimientos dentro del producto vendido. Cada escenario
registra tres ventas y mide guardado, señal visible y número de serializaciones.

Con 100.000 ventas históricas, la referencia tarda aproximadamente 2,4–3,1
segundos en completar cada venta en esta ejecución. La nueva ruta evita ese
recorrido global y serializa seis registros en el caso de un producto de la
prueba. Los tiempos concretos se conservan en los JSON; varían entre ejecuciones
y dispositivos. El campo `phases.fullCommit` del instrumento mide la llamada a
`POSStorage.commit`, que ahora puede utilizar el recorrido incremental.


| Medida, mediana de tres ventas | Referencia | Actualización |
| --- | ---: | ---: |
| Serializaciones por venta | 205,511 | 6 |
| Guardado local completo | 2,775 ms | 398 ms |
| Primera señal visible tras guardar | 3,027 ms | 398 ms |

Antes se midió la actualización del contador; ahora se observa el comprobante
con el ID de la venta que acaba de quedar guardada.

```sh
node tests/minute-benchmark.cjs /ruta/a/referencia minute-baseline
node tests/minute-benchmark.cjs . minute-current
```

La medición es de laboratorio y no sustituye una prueba en el celular físico.
Un navegador sin permiso de almacenamiento o un dispositivo sin espacio puede
seguir impidiendo guardar: se conserva el aviso y el respaldo JSON disponible
desde memoria. No se considera una venta guardada si fallan ambos almacenes.

## Actualización

La PWA v10 publica juntos `index.html`, `pos-offline.js` y `service-worker.js`.
Los reportes continúan exclusivamente en Excel. La confirmación local de la
venta se diferencia de su confirmación posterior en la nube.

Si el aviso de guardado local sigue presente, descargar primero el respaldo
JSON desde Sincronización antes de cerrar o recargar. Después abrir con Internet
para recibir la actualización. Conservar los datos del sitio.
