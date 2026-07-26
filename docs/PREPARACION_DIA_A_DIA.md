# Preparación del escenario "Operaciones día a día"

Qué hacer el día de la prueba, en el entorno desplegado. Pensado para que lo
siga cualquiera del equipo, sin acceso SQL al servidor y dentro de los **8
minutos** de preparación que da el enunciado.

Sustituye `https://EL-DESPLEGADO` por la URL real en todos los ejemplos.

## Versión corta: desde la propia pantalla

En `/dia-a-dia`, panel **"Preparación de la prueba"** (plegado, bajo el estado
de la operación):

1. **Poner en 999** — deja las cuatro sedes con la capacidad que pide la prueba.
2. Escribir la **hora de inicio** (en hora de Lima) y **Generar y cargar** — los
   48 planes de vuelo ajustados a esa hora.

Con eso el entorno queda listo. **Ver sin cargar** los muestra sin tocar nada,
por si hay que enseñarlos antes de agregarlos, y **⬇ descargar .txt** guarda el
archivo.

Al terminar la prueba, **Restaurar originales** devuelve SPIM:440, SABE:460,
EKCH:480, VIDP:480.

Todo va contra el mismo origen que la página, así que no hace falta terminal, ni
acceso SQL, ni que el puerto del backend esté publicado aparte.

> Lo de abajo son los mismos pasos por HTTP, por si hiciera falta hacerlos desde
> fuera de la pantalla.

---

## Antes de nada: qué viaja en el código y qué no

Al desplegar la rama llegan **solo los cambios de código**. El estado de la base
de datos no viaja: lo que se tocó en una base local no aparece en el
despliegue.

| | ¿Llega con el deploy? | Quién lo hace |
|---|---|---|
| Correcciones, pantallas y endpoints | Sí | nadie, va en el deploy |
| **Capacidades a 999** | **No** (es estado de BD) | **paso 1 de abajo** |
| **Planes de vuelo adicionales** | **No** (es estado de BD) | **paso 2 de abajo** |

Los dos últimos son los que hay que hacer a mano, una sola vez, contra el
despliegue. **No hace falta subir archivos ni entrar por SSH**: son dos llamadas
HTTP que se pueden lanzar desde cualquier terminal, o desde la consola del
navegador.

---

## Paso 0 — Comprobar cómo está el entorno

```bash
curl https://EL-DESPLEGADO/api/v1/daily/setup
```

```json
{ "preparado": false, "capacidadEsperada": 999, "sedes": [...] }
```

`preparado: true` significa que las cuatro sedes ya están en 999 y el paso 1
sobra. Si no hay curl a mano, la misma URL abierta en el navegador vale: es un
GET.

---

## Paso 1 — Capacidades a 999

El enunciado pide SPIM, SABE, EKCH y VIDP a 999 antes de empezar.

```bash
curl -X POST https://EL-DESPLEGADO/api/v1/daily/setup
```

Responde con la capacidad anterior y la nueva de cada sede, y reinicia la
operación día a día (hace falta: el servicio guarda el grafo en memoria y no se
enteraría del cambio).

Repetirlo no rompe nada; avisa de que ya estaban puestas.

---

## Paso 2 — Planes de vuelo adicionales

El enunciado **no** entrega un archivo: da una plantilla de 48 vuelos con las
horas como `HO`/`HD`, a ajustar según la hora de la presentación. Por eso no se
pueden preparar antes: dependen de una hora que no se sabe hasta ese día.

No hay que escribirlos ni subir nada. Se le dice la hora y los genera:

```bash
# Revisar primero, sin guardar nada (el enunciado pide presentar el archivo
# antes de agregarlo)
curl -X POST "https://EL-DESPLEGADO/api/v1/daily/setup/flights?hora=11:00&revisar=true"

# Cargarlos de verdad
curl -X POST "https://EL-DESPLEGADO/api/v1/daily/setup/flights?hora=11:00"
```

`hora` es la de inicio de la prueba **en hora de Lima**, en formato 24 h.

```json
{ "aplicado": true, "totalGenerados": 48, "insertados": 48, "actualizados": 0,
  "mensaje": "48 vuelos añadidos y 0 actualizados. Operación día a día reiniciada." }
```

Se **suman** a los 2.866 existentes, no los reemplazan, y ya reinicia la
operación. Repetir la llamada no duplica nada: actualiza los mismos 48.

Si la hora cambia a última hora, se vuelve a llamar con la nueva y listo.

> El mismo cálculo está en `scripts/generar-vuelos-dia-a-dia.py`, que produce un
> `.txt` si se prefiere enseñar el archivo. No hace falta para preparar el
> entorno.

---

## Paso 3 — Cada quien en su terminal

Cada integrante abre `https://EL-DESPLEGADO/dia-a-dia` y elige su sede: Lima
(SPIM), Buenos Aires (SABE), Copenhague (EKCH) o Delhi (VIDP). Queda guardada en
ese navegador; la cabecera muestra el reloj en la hora local de esa ciudad.

El origen no se pregunta al registrar: el enunciado lo considera redundante y
arriesgado, porque el mostrador siempre está en el mismo aeropuerto.

---

## Durante la prueba

| Momento | Dónde |
|---|---|
| Registro a mano de 5-10 envíos | `/dia-a-dia`, formulario |
| Carga del archivo de envíos | `/dia-a-dia`, panel de carga |
| Ver las rutas de un envío en el mapa | `/dia-a-dia/mapa`, o el enlace desde la lista |
| Cancelar un vuelo y ver la reasignación | `/dia-a-dia`, panel de cancelación |

El archivo de envíos acepta las dos formas del enunciado, con id y sin él:

```
10000001-20260726-11-30-SCEL-180-0007729
20260726-11-30-SCEL-180-0007729
```

---

## Al terminar

```bash
curl -X POST https://EL-DESPLEGADO/api/v1/daily/setup/revert
```

Devuelve SPIM:440, SABE:460, EKCH:480, VIDP:480, como pide el cierre del
escenario.

Los planes de vuelo añadidos **no** se borran por HTTP; hace falta SQL:

```sql
DELETE FROM vuelos
 WHERE capacidad = 150
   AND business_id ~ '^VL-(SPIM|SABE|EKCH|VIDP)-';
```

Si no hay acceso a la base, pueden quedarse: son 48 vuelos extra que no estorban
a los otros escenarios. Conviene decirlo al entregar, eso sí.

---

## Si algo va mal

**"No hay aeropuertos en la BD"** — el despliegue está sin datos. Cargar primero
aeropuertos y vuelos por `/api/v1/admin/imports/`.

**Un envío sale rechazado por falta de ruta** — puede ser correcto (no hay
vuelos que lleguen a tiempo), pero si pasa con todos, probablemente falten los
vuelos adicionales del paso 2.

**La carga del archivo devuelve errores por línea** — cada error dice el motivo y
el número de línea. Lo más habitual es la fecha en otro formato: se espera
`aaaammdd`.

**El mapa se ve vacío** — el mapa del día a día solo pinta los envíos
registrados en la sesión. Sin registros, no hay nada que dibujar.
