# Tasf.B2B — asignación de envíos a vuelos con DHGS e IALNS

Sistema de planificación logística que asigna envíos de maletas a rutas aéreas sobre un horizonte configurable. El proyecto mantiene **dos metaheurísticas** sobre el mismo dominio operativo:

- **DHGS** (`Dynamic Hybrid Genetic Search`)
- **IALNS** (`Iterated Adaptive Large Neighborhood Search`)

Ambas comparten la misma simulación por épocas, el mismo `GrafoVuelos`, el mismo `AlgoritmoSPLIT`, el mismo `CalculadorFitness` y el mismo `Validador`.

## Estado actual del sistema

El alcance vigente del repositorio es el siguiente:

- simulación configurable por ventana temporal
- épocas de **4 horas**
- vuelos recurrentes materializados como `InstanciaVuelo`
- ruteo temporal con fechas absolutas de salida y llegada
- operación ideal: **sin cancelaciones ni disrupciones**
- penalizaciones por capacidad, deadline, almacén y no asignados
- suites pesadas de experimentación real separadas del `mvn test` normal mediante la etiqueta `slow-experiment`

## Configuración de experimentación vigente en el repositorio

La configuración actual leída desde `src/test/resources/test-experiment.properties` es:

- `experiment.start=2026-07-14T00:00:00`
- `experiment.epoch.hours=4`
- `experiment.population=6`
- `experiment.time.limit.seconds=1`

### Ventanas verificadas nuevamente a partir del dataset

Reconteo directo sobre `src/test/resources/datos/envios_preliminar`:

| Escenario | Días | Envíos | Maletas |
|---|---:|---:|---:|
| Escenario 3 | 3 | 8578 | 14927 |
| Escenario 5 | 5 | 14162 | 25013 |
| Escenario 7 | 7 | 19547 | 35183 |

Distribución diaria observada para la ventana vigente:

| Fecha | Envíos | Maletas |
|---|---:|---:|
| 2026-07-14 | 3171 | 4925 |
| 2026-07-15 | 2741 | 5001 |
| 2026-07-16 | 2666 | 5001 |
| 2026-07-17 | 2332 | 5001 |
| 2026-07-18 | 3252 | 5085 |
| 2026-07-19 | 2523 | 5085 |
| 2026-07-20 | 2862 | 5085 |

### Ventana de estrés identificada en el dataset completo

El artefacto `target/top_5day_windows.txt` conserva el análisis de la ventana de 5 días más pesada hallada durante la exploración del dataset completo:

- inicio `2029-01-01`
- fin exclusivo `2029-01-06`
- **91210 envíos**
- **174007 maletas**

Esa ventana sirve como referencia de estrés, pero **no es la configuración actualmente chequeada** en `test-experiment.properties`.

## Qué optimizan hoy DHGS e IALNS

Con la implementación actual, ambas metaheurísticas optimizan principalmente:

1. **qué envíos despachar** en la época activa
2. **qué ruta temporal asignar** a cada envío con `AlgoritmoSPLIT` + `GrafoVuelos`
3. **costo operativo** medido como `distancia × maletas`
4. **penalizaciones** por:
   - exceso agregado de capacidad en vuelos
   - violación de deadlines
   - exceso de almacén en aeropuerto origen
   - envíos no asignados

### Importante sobre `representacionGigante`

`representacionGigante` sigue siendo importante, pero hoy actúa sobre todo como:

- representación genética del individuo
- soporte para `OXCrossover`
- estructura de consistencia entre asignados, no asignados y giant tour

Con el `SPLIT` vigente, la mejor ruta de un envío se calcula de manera **independiente** del orden del tour. Por eso, actualmente:

- el orden del `GiantTour` no altera por sí solo la ruta del envío
- sí cambia la solución cuando se agregan, quitan o sustituyen envíos
- los operadores de mejora útiles hoy son `LocalSearchDelete`, `LocalSearchAdd` y `LocalSearchSwapOut`

`LocalSearchConsistencyTest` valida precisamente esa interpretación del modelo actual.

## Factibilidad interna vs validación estricta

Hay dos niveles de chequeo que conviene distinguir:

### 1. Factibilidad interna del individuo

`Individuo.validarFactibilidad()` revisa principalmente:

- must-go no asignados
- rutas factibles (`ruta.esFactible()`)
- ausencia de duplicados y consistencia básica del giant tour
- ausencia de violaciones agregadas de capacidad, tiempo y almacén

### 2. Validación estricta del solucionador

`Validador.validarIndividuo(...)` agrega observaciones explícitas como:

- must-go no asignados
- envíos presentes a la vez en asignados y no asignados
- duplicados en `representacionGigante`
- envíos asignados fuera del giant tour
- rutas desconectadas
- deadline violado
- capacidad excedida por vuelo
- almacén excedido por aeropuerto

Además, `DHGSAlgorithm` intenta priorizar individuos **estrictamente factibles** con `esEstrictamenteFactible(...)` y, si hace falta, aplica una reparación eliminando envíos opcionales antes de seleccionar el mejor retorno.

## Requisitos

| Herramienta | Versión |
|---|---:|
| Java | 21 |
| Maven | Wrapper incluido (`mvnw`) |

## Ejecución rápida

### Compilar

```bash
./mvnw clean compile
```

```powershell
.\mvnw.cmd clean compile
```

### Ejecutar la suite normal

La suite normal **excluye** los tests etiquetados como `slow-experiment`.

```bash
./mvnw clean test
```

```powershell
.\mvnw.cmd clean test
```

### Ejecutar solo pruebas ligeras de algoritmo

```bash
./mvnw -Dtest=DHGSIntegrationTest,IALNSIntegrationTest,DHGSInstanciasDiariasTest,LocalSearchConsistencyTest test
```

```powershell
.\mvnw.cmd "-Dtest=DHGSIntegrationTest,IALNSIntegrationTest,DHGSInstanciasDiariasTest,LocalSearchConsistencyTest" test
```

### Ejecutar manualmente los experimentos pesados

Para incluir los tests marcados como `slow-experiment`, activa el perfil `with-experiments`.

```bash
./mvnw -Pwith-experiments -Dtest=DHGSExperimentacionNumericaTest,IALNSExperimentacionNumericaTest test
```

```powershell
.\mvnw.cmd -Pwith-experiments "-Dtest=DHGSExperimentacionNumericaTest,IALNSExperimentacionNumericaTest" test
```

### Ejecutar solo una metaheurística pesada

```bash
./mvnw -Pwith-experiments -Dtest=DHGSExperimentacionNumericaTest test
./mvnw -Pwith-experiments -Dtest=IALNSExperimentacionNumericaTest test
```

```powershell
.\mvnw.cmd -Pwith-experiments "-Dtest=DHGSExperimentacionNumericaTest" test
.\mvnw.cmd -Pwith-experiments "-Dtest=IALNSExperimentacionNumericaTest" test
```

## Estructura relevante

```text
src/main/java/com/TasfB2B/DHGS/demo/
├── algorithm/
│   ├── dhgs/
│   │   ├── DHGSAlgorithm
│   │   ├── Individuo
│   │   └── Poblacion
│   ├── ialns/
│   │   ├── IALNSAlgorithm
│   │   ├── IALNSState
│   │   └── operators/
│   └── operators/
├── application/
│   ├── dto/
│   └── service/OptimizationService
├── domain/
│   ├── model/
│   │   ├── Aeropuerto
│   │   ├── Vuelo
│   │   ├── InstanciaVuelo
│   │   ├── Envio
│   │   ├── RutaEnvio
│   │   └── AlmacenEstado
│   └── service/
│       ├── SimuladorEpocas
│       └── EpocaData
└── infraestructure/
    ├── ingestion/
    └── util/
        ├── GrafoVuelos
        ├── AlgoritmoSPLIT
        ├── CalculadorFitness
        ├── ConstructorSolucionesIniciales
        └── Validador
```

## Modelo temporal actual

### Horizonte de simulación

- inicio configurable por `experiment.start`
- duración configurable por escenario
- granularidad fija de **4 horas por época**
- total de épocas: `duraciónEnDías × 6`

### Vuelos recurrentes

`Vuelo` representa la plantilla recurrente. `GrafoVuelos` la materializa como múltiples `InstanciaVuelo` fechadas, una por día del horizonte activo.

### Envíos

Cada `Envio`:

- tiene `fechaHoraCreacion`
- entra en la época correspondiente
- recalcula deadline, prioridad y `must-go`
- contribuye con `cantidadMaletas` al costo, la capacidad de vuelos y la ocupación de almacén

## Flujo operativo resumido

1. Se parsean aeropuertos, vuelos y envíos.
2. `SimuladorEpocas` construye las épocas del horizonte.
3. `GrafoVuelos` materializa los vuelos del escenario.
4. En cada época se mezclan envíos nuevos y pendientes.
5. Se recalculan prioridad y `must-go`.
6. Se ejecuta DHGS o IALNS sobre la foto temporal.
7. Se despachan asignados y se arrastran pendientes.
8. Se acumulan costo y estado de almacenes.

## Cómo entran maletas, vuelos y almacenes en la lógica

### Maletas

- el costo de `RutaEnvio` se expresa como `distancia × maletas`
- la carga de vuelo se calcula sumando las maletas de todos los envíos que usan ese vuelo
- la carga de almacén se calcula con las maletas de los envíos no asignados que permanecen en el origen

### Capacidad de vuelos

- `GrafoVuelos` filtra vuelos insuficientes para **un envío aislado**
- `CalculadorFitness` y `Validador` controlan la **sobrecarga agregada** del individuo completo

### Almacenes

- `SimuladorEpocas` mantiene `AlmacenEstado` por aeropuerto
- si un envío no sale, sus maletas siguen ocupando espacio en su aeropuerto de origen
- el exceso de almacén se penaliza y también se reporta explícitamente en validación

## Pruebas actuales

### Unitarias / integración ligera

- `DomainModelTests`
- `SimuladorEpocasTest`
- `LocalSearchConsistencyTest`
- `DHGSInstanciasDiariasTest`
- `DHGSIntegrationTest`
- `IALNSIntegrationTest`

### Experimentación real opt-in

- `DHGSExperimentacionNumericaTest`
- `IALNSExperimentacionNumericaTest`

Ambas suites leen fecha de inicio, duración, población, límite por época y conteos esperados desde `test-experiment.properties`, pero no se ejecutan con `mvn test` normal porque están marcadas como `slow-experiment`.

## Fuera de alcance por ahora

Actualmente el sistema no modela:

- cancelaciones de vuelos
- disrupciones operativas durante la simulación
- replanificación reactiva por incidentes

## Documentación complementaria

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`PSEUDOCODE.md`](PSEUDOCODE.md)
- [`RESULTS.md`](RESULTS.md)
- [`HELP.md`](HELP.md)
