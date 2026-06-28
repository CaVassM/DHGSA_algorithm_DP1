# A22 / A23 — Salto de algoritmo y simulación de periodo

> Entregables escritos de la hoja P&R (pregunta 14). **A22** = cómo se consumen los
> datos en bloques de tiempo (un salto de consumo por cada salto de algoritmo).
> **A23** = interacción multi-navegador durante la simulación de periodo.
>
> Este documento describe el sistema **tal como está implementado hoy** (rama
> `master`, commits `9428f46` salto+WS y `8b8412e` colapso), usando el vocabulario
> del profesor (TA / SA / Sc / K). El diagrama visual se arma a partir de esto.

---

## 0. Vocabulario común (profesor) ↔ implementación

El profesor pidió un "idioma común" para conversar sobre las soluciones. Esta es la
correspondencia entre sus términos y lo que hay en el código:

| Término del profesor | Símbolo | En el código | Notas |
|---|---|---|---|
| Tiempo del algoritmo | **TA** | `timeLimitSeconds` (cota), tiempo real de `dhgs.ejecutar`/`ialns.ejecutar` por época | Hoy se acota con un límite de tiempo por época; no se mide ni se valida `SA > TA`. |
| Salto del algoritmo | **SA** | implícito en `pausaMs = epochHours·3600 / multiplicador` | El ritmo entre corridas no se fija como SA explícito; sale del multiplicador y el tamaño de época. |
| Constante de proporcionalidad | **K** | `multiplicadorTemporal` (LiveSimulationRequest) | Mismo rol. Valores en el código: 60/120/240/480 (el profe ejemplificó 1/14/75). |
| Salto de consumo | **Sc** | tamaño de época: `epochHours` (4h por defecto) | Cuántos datos (tiempo simulado) se consumen por corrida. Ver §2. |
| Colapso logístico | — | modo colapso: saturación de almacén o % sin atender ≥ umbral | `SimulacionEnVivoService` + `CollapseReportResponse`. |

**Estrategia implementada:** planificación programada fija sobre **épocas fijas de
4h** (constante `DURACION_EPOCA_HORAS` en `SimuladorEpocas`). Es una variante válida
del esquema del profe: en vez de una ventana de consumo `Sc = SA × K` *deslizante*,
se trocea el horizonte en bloques fijos contiguos y se procesa uno por uno contra el
reloj. El efecto observable (consumir más datos por vez al subir K) es el mismo.

---

## A22 — Consumo de datos en bloques de tiempo

### Idea central (la del profesor)

Acelerar la simulación **no** se logra optimizando ni corriendo más rápido el
algoritmo: se logra **consumiendo más datos por vez**. TA y SA viven en tiempo real;
lo que se estira es cuántos minutos de datos agarra cada corrida (el salto de
consumo). Por eso hay **dos ejes temporales distintos**.

### Los dos ejes

```
Eje de EJECUCIÓN del planificador (tiempo real del usuario)
  |----[TA]----|        |----[TA]----|        |----[TA]----|
 10:05        ...      10:06          ...    10:07
  ^ corrida 1           ^ corrida 2           ^ corrida 3
  |<--------- SA ------->|<--------- SA ------->|
  (SA = pausa real entre corridas = epochHours·3600 / K, troceada para cancelar)

Eje del TIEMPO DE LOS PEDIDOS (tiempo simulado de los envíos)
  [=== época 1 ===][=== época 2 ===][=== época 3 ===] ...
  00:00         04:00            08:00            12:00
   ^ consume todos los              cada bloque = Sc = epochHours (4h) de datos
     envíos creados en              simulados; al subir K, cada bloque dura
     [inicio, inicio+4h)            MENOS tiempo real → simulación más rápida
```

- **Eje de ejecución**: cada corrida del planificador dura TA (acotado por
  `timeLimitSeconds`); entre corrida y corrida transcurre SA en tiempo real.
- **Eje de los pedidos**: cada corrida consume un bloque de `Sc = epochHours` de
  datos simulados. La corrida *n* procesa los envíos del intervalo
  `[inicio + (n-1)·4h, inicio + n·4h)`.

### Relación de velocidad (el papel de K)

`pausaMsPorEpoca = epochHours · 3600 / K` (en `SimulacionEnVivoService.calcularPausaMs`).

- Con `epochHours = 4` y `K = 240`: cada bloque de 4h simuladas dura
  `4·3600/240 = 60 s` reales. Una semana (7 días = 42 épocas) ≈ **42 min reales**
  → dentro de la meta del enunciado (30–90 min).
- Subir K ⇒ menos segundos reales por bloque ⇒ simulación más rápida, **sin** tocar
  el algoritmo. Bajar K hacia 1 ⇒ ritmo cercano al tiempo real (operación día a día).

### Qué se consume en cada bloque (lo que el profe llama "todos los pendientes")

Clave para el diagrama: cada corrida **no** mira solo los envíos nuevos de su
ventana. Arrastra los **pendientes** de las corridas anteriores:

1. `prepararEpoca(epoca, pendientes)` inyecta los postergados de la época previa
   junto con los envíos nuevos del bloque (`getTodosLosEnvios()` = nuevos +
   pendientes). Registra llegadas en almacenes y recalcula *must-go* y prioridad
   según el momento de la época.
2. El algoritmo (DHGS o IALNS) optimiza ese conjunto con cota `timeLimitSeconds`.
3. `finalizarEpoca(epoca, mejor)` separa **despachados** (asignados) de
   **postergados** (no asignados) y devuelve los postergados → entran como
   `pendientes` de la siguiente corrida.

Esto materializa el "considera todos los pedidos pendientes o de replanificación
hasta ese momento" de la transcripción: un envío no atendido en su bloque reaparece
en el siguiente hasta despacharse o vencer.

### Emisión por bloque (el delay pequeño pero notorio)

Al cerrar cada época, el backend emite un evento `EPOCA` por WebSocket
(`/topic/simulacion/{runId}`) con: número de época, reloj simulado (`fin` de la
época), despachados, pendientes, rutas, ocupación de almacenes y acumulados. Luego
`dormir(pausaMs)` (troceado cada 200 ms para reaccionar a cancelaciones) antes del
siguiente bloque. El frontend pinta el avance al recibir el evento → el delay
algoritmo↔mapa es de ms, como pedía el profe.

### Secuencia de eventos del topic

`INICIO` (total de épocas, rango, K) → `EPOCA` × N (uno por bloque) →
`FIN` (resumen) — o `COLAPSO` (con `CollapseReportResponse`) si en modo colapso se
satura un almacén o se supera el umbral de % sin atender, lo que corta la corrida.

### Multi-escenario con el mismo motor

El mismo loop sirve para los tres escenarios cambiando parámetros, no el código:

| Escenario | Cómo se obtiene hoy |
|---|---|
| Operación día a día | K bajo (cercano a tiempo real). |
| Simulación de N días | K medio (p.ej. 240) + `horizonDays`. Meta: semana en 30–90 min. |
| Simulación al colapso | `POST /simulacion/collapse` con `factorCarga` (x2/x5/x10) y `umbralColapso`; emite `COLAPSO` al saturar. |

### Riesgos de calibración (advertencia del profesor, para el texto del entregable)

- **SA muy grande** (turnos de 8–24h) ⇒ colapso temprano: envíos con deadline de
  4–8h no se planifican a tiempo.
- **SA < TA** ⇒ se relanza antes de terminar la corrida anterior ⇒ la solución
  colisiona/cae. En la implementación esto se evita sirviendo **una simulación a la
  vez** (`ReentrantLock simulacionLock`) y esperando `pausaMs` entre bloques.
- **SA ligeramente > TA** ⇒ puede funcionar; hay que calibrar `K` (y, si se modela
  SA/TA explícito, medir TA cerca del colapso, con muchos pedidos, no con pocos).

---

## A23 — Interacción multi-navegador durante la simulación

### Topología

```
   Navegador A ─┐                         ┌─ suscrito a /topic/simulacion/{runId}
   Navegador B ─┤   WebSocket/STOMP (/ws) │
   Navegador C ─┘────────────────────────┤   Backend Spring
                  (SockJS fallback)       │   ├─ LiveSimulationController (REST: arrancar/cancelar)
                                          │   ├─ SimpleBroker "/topic" (+ heartbeat 10s/10s)
                                          └─→ └─ SimulacionEnVivoService (@Async, 1 a la vez)
                                                   └─ emite eventos al topic
```

### Cómo se conectan los navegadores

- **Transporte** (`WebSocketConfig`): endpoint STOMP `/ws` (WebSocket nativo **y**
  SockJS como fallback). `SimpleBroker` sobre prefijo `/topic` con heartbeats
  10s/10s (evita cuelgues de `@stomp/stompjs` esperando el frame CONNECTED).
- **Cliente** (`simulacionSocket.js`): cada navegador abre su cliente STOMP a
  `ws://localhost:8080/ws` y hace `subscribe(topic, ...)`. `suscribirSimulacion`
  devuelve un `disconnect` que la pantalla limpia al desmontar.

### Modelo de difusión (broadcast por topic)

- Arrancar una simulación (`POST /api/v1/simulacion/live` o `/collapse`) devuelve
  `{ runId, topic }`. El `runId` lo genera el backend (`AtomicLong`).
- **Todos** los navegadores suscritos a `/topic/simulacion/{runId}` reciben **los
  mismos** eventos `EPOCA`/`FIN`/`COLAPSO` → ven la simulación sincronizada. Es un
  topic de difusión, no colas por usuario: abrir el mismo `runId` en varias pestañas
  o máquinas muestra el mismo avance.
- Distintos `runId` = simulaciones independientes en topics distintos.

### Concurrencia y aislamiento (lo que hay que saber para el diagrama)

- **Una simulación a la vez en el servidor**: `SimuladorEpocas` y `GrafoVuelos` son
  beans singleton con estado mutable; `ReentrantLock simulacionLock` serializa las
  corridas. Si B arranca mientras corre la de A, B **espera turno** (no corrompe el
  estado). Esto es del lado del *cómputo*, no de la *difusión*: muchos navegadores
  pueden observar a la vez, pero el motor procesa una corrida por vez.
- **Cancelación**: `POST /simulacion/live/{runId}/cancel` marca un `AtomicBoolean`
  por `runId`; el loop lo consulta entre bloques y durante la espera troceada →
  corta y emite `FIN ("cancelada")`. Cualquier navegador puede cancelar; todos ven
  el `FIN`.
- **Reconexión**: el broker no reenvía el historial; un navegador que se suscribe
  tarde solo ve los eventos a partir de su `subscribe` (los bloques ya emitidos no
  se reenvían). Para reincorporarse al estado se requeriría snapshot/replay
  (no implementado; ver §pendientes).

### Secuencia multi-navegador (texto para el diagrama)

1. Navegador A: `POST /simulacion/live` → recibe `{ runId=R, topic=T }`.
2. A se suscribe a `T`; B y C también se suscriben a `T` (lo conocen por compartir
   `R`).
3. Backend emite `INICIO` → A, B, C lo reciben simultáneamente.
4. Por cada bloque: emite `EPOCA` → A, B, C actualizan progreso/reloj/almacenes.
5. C envía `cancel` (o llega `FIN`/`COLAPSO`) → todos reciben el cierre y dejan de
   animar.

---

## Pendientes / decisiones abiertas (no bloquean el entregable, sí el "idioma 100%")

1. **SA/TA explícitos**: hoy SA es implícito (vía K y tamaño de época) y TA no se
   mide. Para hablar exactamente el idioma del profe se podría exponer SA y medir TA
   por corrida, validando `SA > TA`.
2. **Ventana deslizante vs épocas fijas**: el profe describe `Sc = SA × K`
   deslizante; el código usa bloques fijos de 4h. Equivalente en efecto, distinto en
   forma. Migrar a ventana deslizante es un cambio de motor (coordinar con el equipo).
3. **Renombrar `multiplicadorTemporal → K`** en DTO/UI para alinear nomenclatura
   (cosmético pero ayuda a la comunicación con el profe).
4. **Pre-buffer de Max**: `preBuffer` existe en el request pero está **reservado**
   (no implementado). El profe no lo exige (confía en `SA > TA` como margen).
5. **Replay para suscriptores tardíos** (multi-navegador): hoy quien llega tarde no
   ve los bloques pasados.
