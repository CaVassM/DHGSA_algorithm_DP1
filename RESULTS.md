# Resultados — Interpretación del estado actual de DHGS

Este documento describe cómo interpretar los resultados del sistema en su estado actual.

## Alcance funcional de referencia

Los resultados del proyecto deben leerse bajo estas condiciones:

- horizonte configurable por escenario; la experimentación de referencia usa **3**, **5** y **7 días**
- épocas de **4 horas**
- vuelos recurrentes materializados como `InstanciaVuelo`
- rutas construidas sobre tiempos absolutos de salida/llegada
- operación ideal **sin cancelaciones**

## Escenarios de prueba de algoritmo vigentes

La experimentación numérica real del algoritmo quedó consolidada en `DHGSExperimentacionNumericaTest` con tres escenarios reproducibles:

1. **ventana real de 3 días**
2. **ventana real de 5 días**
3. **ventana real de 7 días**

La fecha de inicio y los parámetros de la corrida se leen desde `src/test/resources/test-experiment.properties`.

---

## Qué retorna DHGS

El algoritmo devuelve un `Individuo` con estos campos relevantes:

| Campo | Significado |
|---|---|
| `enviosAsignados` | mapa `Envio -> RutaEnvio` |
| `enviosNoAsignados` | envíos que no fueron despachados en la solución |
| `fitness` | función objetivo total |
| `costoDistanciaTotal` | costo puro por distancia |
| `violacionesCapacidad` | penalización cuadrática por exceso de capacidad |
| `violacionesTiempo` | penalización cuadrática por retrasos |
| `violacionesAlmacen` | penalización por exceso en almacenes |
| `lateness` | suma lineal de retrasos |
| `esFactible` | indica si la solución cumple restricciones duras |

---

## Cómo interpretar `representacionGigante`

`representacionGigante` debe leerse hoy como una representación **genética y estructural** del individuo:

- contiene los envíos que pertenecen a la solución candidata
- debe ser consistente con `enviosAsignados`
- no debe contener duplicados

En la implementación actual **no** debe interpretarse todavía como una secuencia operativa que cambie por sí sola el costo de las rutas, porque `AlgoritmoSPLIT` asigna cada envío de manera independiente.

Consecuencia práctica:

- si el conjunto de envíos es el mismo, reordenar el `GiantTour` no debería alterar el resultado del `SPLIT` actual
- las mejoras reales observables provienen sobre todo de agregar, quitar o sustituir envíos de la solución

---

## Fórmula de fitness actual

```text
fitness = distanciaTotal
        + penCapacidad × violacionesCapacidad
        + penTiempo × violacionesTiempo
        + penCapacidad × violacionesAlmacen
        + penalizacionNoAsignados
```

### Interpretación rápida

- si `fitness ≈ costoDistanciaTotal`, la solución está muy cerca del ideal
- si `violacionesCapacidad = 0` y `violacionesTiempo = 0`, la solución no rompe restricciones duras
- si existen `enviosNoAsignados`, el fitness sube por penalización aunque la solución aún pueda ser factible

### Qué significa cada penalización en términos físicos

- `costoDistanciaTotal`: suma de `distancia × maletas` por cada envío asignado
- `violacionesCapacidad`: exceso cuadrático de maletas sobre la capacidad agregada de los vuelos usados
- `violacionesAlmacen`: exceso cuadrático de maletas que permanecen almacenadas en el aeropuerto de origen
- `penalizacionNoAsignados`: castigo por envíos que permanecen en tierra y siguen ocupando almacén

---

## Cómo leer las salidas de la experimentación 3/5/7 días

Cada escenario imprime un bloque con:

- envíos incluidos en la ventana
- envíos despachados y pendientes al cierre
- maletas despachadas
- costo acumulado
- tiempo de filtrado/carga
- tiempo de simulación
- tiempo total del escenario
- distribución diaria de envíos dentro de la ventana

Esto permite usar la suite no solo como validación funcional, sino también como base reproducible para medir tiempo de ejecución.

---

## Lectura del bloque resumen

El bloque resumen impreso por las pruebas tiene esta forma:

```text
=== EXPERIMENTACIÓN NUMÉRICA DHGS ===
Escenario: 5 días
ID escenario: 5
Inicio simulación: 2026-01-01T00:00
Épocas: 30
Envíos en ventana: 2011
Envíos despachados: 1964
Envíos pendientes: 47
Maletas despachadas: 2757
Costo acumulado: 24399331.33
Tiempo filtrado/carga: ... ms
Tiempo simulación: ... ms
Tiempo total escenario: ... ms
Distribución por día:
  2026-01-02 -> 488 envíos
  ...
```

### Lectura recomendada

1. **`Escenario` e `ID escenario`**
   - identifican la ventana evaluada (`3`, `5` o `7` días)
2. **`Épocas`**
   - debe coincidir con la fórmula `días × 6` porque cada época dura 4 horas
3. **`Envíos en ventana`, `despachados` y `pendientes`**
   - permiten verificar cobertura del escenario y balance final al cierre
4. **`Maletas despachadas` y `Costo acumulado`**
   - resumen la carga movilizada y el costo operativo agregado
5. **Tiempos de carga/filtrado, simulación y total**
   - sirven para comparar desempeño entre horizontes de 3, 5 y 7 días

---

## Qué significan los no asignados hoy

En el estado actual del sistema, un envío no asignado no implica cancelación ni disrupción.

Normalmente significa una de estas cosas:

- no hubo ruta factible en el horizonte configurado
- la combinación de capacidad y tiempos no permitió asignarlo
- la solución elegida priorizó otras asignaciones para optimizar el fitness total

Además, cada no asignado implica que sus **maletas siguen ocupando almacén** en su aeropuerto origen. Por eso un conjunto grande de no asignados puede aumentar simultáneamente:

- la penalización por no asignados
- la `violacionesAlmacen`

---

## Qué ya no debe aparecer en resultados

Dado el alcance actual, los resultados **no deben** mencionar:

- vuelos cancelados
- rutas no operables por cancelación
- replanificación por disrupciones

Si aparece alguno de esos conceptos, el resultado está desalineado con la versión actual del sistema.

---

## Resultado esperado de la documentación de pruebas

La validación documental del proyecto ahora se resume así:

- `DHGSIntegrationTest`: validación con datos pequeños y horizonte materializado
- `DHGSInstanciasDiariasTest`: validación puntual de uso de instancias diarias
- `LocalSearchConsistencyTest`: validación de coherencia de giant tour, maletas y almacenes
- `DHGSExperimentacionNumericaTest`: validación del algoritmo sobre ventanas reales de **3**, **5** y **7** días

## Corrida validada de referencia (2026-04-29)

La suite `DHGSExperimentacionNumericaTest` fue ejecutada exitosamente con `mvn -Dtest=DHGSExperimentacionNumericaTest test` y arrojó estos resultados:

| Escenario | Envíos | Despachados | Pendientes | Maletas | Costo acumulado | Tiempo simulación | Tiempo total |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3 días | 983 | 939 | 44 | 1319 | 10,960,418.93 | 11,958 ms | 11,961 ms |
| 5 días | 2011 | 1964 | 47 | 2757 | 24,399,331.33 | 30,829 ms | 30,830 ms |
| 7 días | 3071 | 3002 | 69 | 4200 | 37,556,504.80 | 58,356 ms | 58,358 ms |

### Distribución diaria observada

- **3 días**
  - `2026-01-02`: 488 envíos
  - `2026-01-03`: 495 envíos
- **5 días**
  - `2026-01-02`: 488 envíos
  - `2026-01-03`: 495 envíos
  - `2026-01-04`: 512 envíos
  - `2026-01-05`: 516 envíos
- **7 días**
  - `2026-01-02`: 488 envíos
  - `2026-01-03`: 495 envíos
  - `2026-01-04`: 512 envíos
  - `2026-01-05`: 516 envíos
  - `2026-01-06`: 516 envíos
  - `2026-01-07`: 544 envíos

### Lectura recomendada de esta corrida

- los tres escenarios pasan en una misma ejecución automatizada
- la ventana temporal real queda controlada desde `test-experiment.properties`
- el tiempo total crece de forma consistente con el tamaño de la ventana y la carga procesada
- el escenario de 7 días queda integrado en la misma suite numérica que los escenarios de 3 y 5 días
