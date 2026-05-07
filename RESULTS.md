# Resultados — interpretación actual de DHGS e IALNS

Este documento explica cómo leer los resultados del sistema en el estado actual del repositorio.

## Alcance funcional vigente

Los resultados deben interpretarse bajo estas condiciones:

- horizonte configurable por escenario
- épocas de **4 horas**
- vuelos recurrentes materializados como `InstanciaVuelo`
- rutas construidas sobre tiempos absolutos de salida y llegada
- operación ideal **sin cancelaciones ni disrupciones**
- penalizaciones por capacidad, deadline, almacén y no asignados

## Configuración actualmente versionada

La configuración de experimentación hoy almacenada en `src/test/resources/test-experiment.properties` es:

- `start = 2026-07-14T00:00:00`
- `population = 6`
- `time.limit.seconds = 1`
- escenarios de `3`, `5` y `7` días

### Conteos verificados nuevamente sobre el dataset

Se recontaron los archivos reales de `src/test/resources/datos/envios_preliminar` sin ejecutar las metaheurísticas. El resultado coincide con la configuración vigente:

| Escenario | Envíos | Maletas |
|---|---:|---:|
| 3 días | 8578 | 14927 |
| 5 días | 14162 | 25013 |
| 7 días | 19547 | 35183 |

### Distribución diaria de la ventana vigente

| Fecha | Envíos | Maletas |
|---|---:|---:|
| 2026-07-14 | 3171 | 4925 |
| 2026-07-15 | 2741 | 5001 |
| 2026-07-16 | 2666 | 5001 |
| 2026-07-17 | 2332 | 5001 |
| 2026-07-18 | 3252 | 5085 |
| 2026-07-19 | 2523 | 5085 |
| 2026-07-20 | 2862 | 5085 |

## Ventana de estrés conocida

El análisis preservado en `target/top_5day_windows.txt` sigue siendo útil para interpretar escenarios extremos del dataset completo. La mejor ventana de 5 días detectada fue:

| Inicio | Fin exclusivo | Envíos | Maletas | Promedio maletas/envío |
|---|---|---:|---:|---:|
| 2029-01-01 | 2029-01-06 | 91210 | 174007 | 1.908 |

Esta cifra **no corresponde a la configuración actual del repositorio**, sino a una referencia de estrés para corridas manuales.

---

## Qué retorna realmente cada metaheurística

Tanto DHGS como IALNS retornan un `Individuo` con estos campos relevantes:

| Campo | Significado |
|---|---|
| `enviosAsignados` | mapa `Envio -> RutaEnvio` |
| `enviosNoAsignados` | envíos no despachados en la solución |
| `fitness` | función objetivo total |
| `costoDistanciaTotal` | costo puro por distancia |
| `violacionesCapacidad` | penalización por exceso agregado de capacidad |
| `violacionesTiempo` | penalización por retrasos / deadlines |
| `violacionesAlmacen` | penalización por almacenes excedidos |
| `lateness` | suma lineal de retrasos |
| `esFactible` | factibilidad interna del individuo |

---

## Cómo interpretar `representacionGigante`

Hoy `representacionGigante` debe leerse como una estructura **genética y de consistencia**, no como un secuenciador operativo fuerte.

Implica que:

- contiene los envíos que participan de la solución candidata
- debe ser consistente con `enviosAsignados`
- no debe contener duplicados
- cambiar el orden del tour, por sí solo, no altera la ruta escogida por `SPLIT`

Consecuencia práctica: en la versión actual, las mejoras observables vienen sobre todo de **agregar, quitar o sustituir envíos**, no de reordenarlos.

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

- si `fitness ≈ costoDistanciaTotal`, la solución está cerca del ideal
- si `violacionesCapacidad = 0`, `violacionesTiempo = 0` y `violacionesAlmacen = 0`, no hay violaciones agregadas registradas
- si existen `enviosNoAsignados`, el fitness sube aunque aún pueda existir una solución internamente factible

### Interpretación física

- `costoDistanciaTotal`: suma de `distancia × maletas`
- `violacionesCapacidad`: exceso cuadrático de maletas sobre capacidad agregada de vuelos
- `violacionesAlmacen`: exceso cuadrático de maletas que siguen en origen
- `penalizacionNoAsignados`: castigo por no despachar envíos disponibles

---

## Factibilidad interna vs validación estricta

### Factibilidad interna

`Individuo.validarFactibilidad()` revisa:

- must-go no asignados
- consistencia básica de giant tour
- rutas `ruta.esFactible()`
- violaciones agregadas iguales a cero

### Validación estricta

`Validador.validarIndividuo(...)` agrega observaciones explícitas de:

- rutas desconectadas
- deadlines violados
- exceso de capacidad por vuelo
- almacenes excedidos
- envíos fuera del giant tour
- envíos duplicados entre asignados y no asignados

### Lectura importante para resultados de DHGS

Desde la implementación actual de `DHGSAlgorithm`:

- si una solución no es estrictamente factible, DHGS intenta repararla eliminando envíos opcionales conflictivos
- la selección final de retorno prioriza factibilidad estricta y luego fitness

Eso significa que el resultado final de DHGS debe leerse como **el mejor individuo retornable bajo esas reglas**, no simplemente como el mejor fitness bruto generado en una iteración intermedia.

---

## Cómo leer las salidas de experimentación 3/5/7 días

Cuando se ejecutan manualmente `DHGSExperimentacionNumericaTest` o `IALNSExperimentacionNumericaTest`, cada escenario imprime:

- envíos incluidos en la ventana
- envíos despachados y pendientes al cierre
- maletas despachadas
- costo acumulado
- tiempo de filtrado/carga
- tiempo de simulación
- tiempo total del escenario
- distribución diaria de envíos

Ejemplo conceptual:

```text
=== EXPERIMENTACIÓN NUMÉRICA DHGS ===
Escenario: 5 días
ID escenario: 5
Inicio simulación: 2026-07-14T00:00
Épocas: 30
Envíos en ventana: 14162
Envíos asignados/despachados: ...
Envíos pendientes/no asignados: ...
Maletas despachadas: ...
Costo acumulado: ...
Tiempo filtrado/carga: ...
Tiempo simulación: ...
Tiempo total escenario: ...
Distribución por día:
  2026-07-14 -> 3171 envíos
  ...
```

### Lectura recomendada

1. **Escenario / ID escenario**
   - identifica la ventana evaluada
2. **Épocas**
   - debe coincidir con `días × 6`
3. **Envíos en ventana, despachados y pendientes**
   - muestran cobertura y backlog residual
4. **Maletas despachadas y costo acumulado**
   - resumen carga movilizada y costo operativo
5. **Tiempos**
   - sirven para comparar escalamiento entre ventanas

---

## Qué significan los no asignados hoy

Un envío no asignado no implica cancelación ni disrupción. Normalmente significa una de estas cosas:

- no hubo ruta factible dentro del horizonte configurado
- la combinación de capacidad y tiempos no permitió asignarlo
- la solución elegida prefirió otras asignaciones por fitness total

Además, los no asignados siguen ocupando almacén en el aeropuerto de origen, así que pueden incrementar a la vez:

- `penalizacionNoAsignados`
- `violacionesAlmacen`

---

## Estrategia de pruebas y lectura de resultados

### Suite normal

`mvn test` excluye por defecto los tests marcados como `slow-experiment`. Por tanto, la suite normal valida integración ligera y consistencia del modelo, sin lanzar corridas pesadas sobre datos reales.

### Experimentación manual

Para interpretar resultados de DHGS/IALNS sobre las ventanas reales configuradas se debe ejecutar manualmente:

```text
mvn -Pwith-experiments -Dtest=DHGSExperimentacionNumericaTest,IALNSExperimentacionNumericaTest test
```

Esto separa dos objetivos distintos:

1. validación cotidiana del código
2. experimentación numérica reproducible u observación de desempeño

---

## Qué ya no debe aparecer en resultados

Dado el alcance actual, los resultados no deben mencionar:

- vuelos cancelados
- rutas no operables por cancelación
- replanificación por disrupciones

Si aparece alguno de esos conceptos, el resultado está desalineado con la versión actual del sistema.

