# Arquitectura — Tasf.B2B DHGS / IALNS

## Resumen arquitectónico actual

El sistema se encuentra en un alcance funcional estable con estas decisiones vigentes:

- horizonte de simulación **configurable por escenario**
- partición temporal en épocas de **4 horas**
- `Vuelo` como **plantilla recurrente**
- `InstanciaVuelo` como **ocurrencia diaria materializada**
- optimización por época mediante **DHGS** o **IALNS**
- operación en **condiciones ideales**, sin cancelaciones ni disrupciones
- configuración de experimentación leída desde `src/test/resources/test-experiment.properties`
- ventana actualmente chequeada: `2026-07-14T00:00:00`
- suites pesadas separadas del `mvn test` normal mediante `@Tag("slow-experiment")`
- ambas metaheurísticas comparten **dominio, simulación temporal, restricciones y datos de entrada**, pero permanecen **separadas internamente**

---

## Diagrama de capas

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION                                 │
│   controller/          API REST / UI futura                         │
├─────────────────────────────────────────────────────────────────────┤
│                        APPLICATION                                  │
│   service/             OptimizationService                          │
│   dto/                 OptimizationRequest / Response               │
├─────────────────────────────────────────────────────────────────────┤
│                          DOMAIN                                     │
│                                                                     │
│   model/               Aeropuerto                                   │
│                        Vuelo            ← plantilla recurrente       │
│                        InstanciaVuelo   ← vuelo fechado diario       │
│                        Envio                                     │
│                        RutaEnvio                                  │
│                        AlmacenEstado                              │
│                                                                     │
│   service/             SimuladorEpocas                              │
│                        EpocaData                                    │
│                                                                     │
│   valueobject/         ParametrosPenalizacion                       │
├─────────────────────────────────────────────────────────────────────┤
│                       ALGORITHM                                     │
│                                                                     │
│   dhgs/                DHGSAlgorithm                                │
│                        Individuo                                    │
│                        Poblacion                                    │
│                                                                     │
│   ialns/               IALNSAlgorithm                               │
│                        IALNSState                                   │
│                        destroy/repair operators                     │
│                                                                     │
│   operators/           OXCrossover                                  │
│                        LocalSearchDelete                            │
│                        LocalSearchAdd                               │
│                        LocalSearchSwapOut                           │
│                        LocalSearchRelocate                          │
│                        LocalSearchSwap                              │
│                        LocalSearch2Opt                              │
│                        LocalSearchContext                           │
├─────────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                                 │
│                                                                     │
│   ingestion/           AeropuertoParser                             │
│                        VueloParser                                  │
│                        EnvioParser                                  │
│                                                                     │
│   util/                GrafoVuelos                                  │
│                        AlgoritmoSPLIT                               │
│                        CalculadorFitness                            │
│                        ConstructorSolucionesIniciales               │
│                        Validador                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Flujo de datos actual

```text
ARCHIVOS DE DATOS
   │
   ├─ aeropuertos
   ├─ vuelos plantilla
   └─ envíos
   │
   ▼
PARSERS
   │
   ▼
SIMULADOR DE ÉPOCAS
   │
   ├─ define fecha de inicio
   ├─ genera (días × 24 / 4) épocas de 4 horas
   └─ expone el horizonte del escenario configurado
   │
   ▼
GRAFO DE VUELOS
   │
   ├─ recibe vuelos plantilla
   ├─ materializa una instancia diaria por vuelo para cada día del escenario
   └─ construye el grafo operativo del horizonte
   │
   ▼
DHGS POR ÉPOCA
   │
   ├─ población inicial
   ├─ loop genético
   ├─ SPLIT + búsqueda local
   └─ mejor individuo
   │
   ├─────────────────────────────────────────────────────────────────┐
   │                                                                 │
   │ IALNS POR ÉPOCA                                                 │
   │                                                                 │
   │ ├─ solución inicial sobre el mismo dominio                      │
   │ ├─ destroy / repair adaptativo                                  │
   │ ├─ simulated annealing                                           │
   │ └─ mejor individuo                                              │
   │                                                                 │
   └─────────────────────────────────────────────────────────────────┘
   │
   ▼
RESULTADO DE ÉPOCA
   │
   ├─ envíos asignados
   ├─ envíos no asignados
   ├─ costo
   └─ estado de almacenes
```

---

## Configuración de referencia y ventanas conocidas

### Ventana actualmente versionada

El repositorio hoy está alineado a esta configuración de referencia ligera/media:

| Escenario | Días | Envíos | Maletas |
|---|---:|---:|---:|
| Escenario 3 | 3 | 8578 | 14927 |
| Escenario 5 | 5 | 14162 | 25013 |
| Escenario 7 | 7 | 19547 | 35183 |

Estas cifras fueron verificadas directamente sobre el dataset real y coinciden con `test-experiment.properties`.

### Ventana de estrés preservada como referencia analítica

El análisis offline conservado en `target/top_5day_windows.txt` identificó como ventana más pesada de 5 días:

- inicio `2029-01-01`
- fin exclusivo `2029-01-06`
- `91210` envíos
- `174007` maletas

Arquitectónicamente, esto implica que el sistema puede evaluarse en dos regímenes distintos:

1. **ventana versionada actual** para validación reproducible y corridas manejables
2. **ventana de estrés 2029** para pruebas manuales no rutinarias

---

## Modelo temporal

### Épocas

Cada época representa una ventana de decisión del negocio.

- duración: **4 horas**
- total: **`díasDelEscenario × 24 / 4`**
- cobertura completa: **duración configurada del escenario**

Las épocas sirven para:

1. liberar envíos según su `fechaHoraCreacion`
2. mezclar nuevos + pendientes
3. recalcular `must-go` y prioridad
4. ejecutar DHGS o IALNS en una foto temporal del sistema

### Vuelos

El modelo actual distingue dos conceptos:

#### `Vuelo`
Plantilla recurrente base.

Contiene:
- origen / destino
- hora de salida
- hora de llegada
- capacidad
- distancia
- duración

#### `InstanciaVuelo`
Ocurrencia concreta de un `Vuelo` dentro del horizonte.

Contiene además:
- `fechaOperacion`
- `fechaHoraSalida`
- `fechaHoraLlegada`
- `idPlantilla`

Esto permite que el grafo trabaje con arcos fechados y no con horarios abstractos solamente.

---

## Grafo actual

`GrafoVuelos` sigue usando:

- nodos = aeropuertos
- arcos = vuelos materializados (`InstanciaVuelo`)

Pero ahora la búsqueda considera:

- capacidad requerida
- tiempo mínimo de salida según el envío o la conexión previa
- llegada más temprana factible al siguiente nodo

En otras palabras, el grafo ya no representa solo conectividad geográfica; representa conectividad **temporalmente operable** dentro del horizonte configurado para cada escenario.

---

## Individuo de DHGS

```text
Individuo
├── representacionGigante: List<Envio>
├── enviosAsignados: Map<Envio, RutaEnvio>
├── enviosNoAsignados: List<Envio>
├── fitness
├── costoDistanciaTotal
├── violacionesCapacidad
├── violacionesTiempo
├── violacionesAlmacen
├── lateness
└── esFactible
```

La `RutaEnvio` asociada a cada envío contiene una secuencia de `InstanciaVuelo` cuando el grafo fue materializado para el horizonte.

### Papel real de `representacionGigante`

En la implementación actual, `representacionGigante` es coherente como:

- representación genética del individuo
- entrada del `OXCrossover`
- estructura de consistencia para saber qué envíos pertenecen a la solución

Sin embargo, **no actúa todavía como secuenciador operativo fuerte**, porque `AlgoritmoSPLIT.split(...)` evalúa cada `Envio` de forma independiente. Por eso:

- cambiar el orden del tour no altera la mejor ruta de un envío dado
- los movimientos que solo reordenan (`Relocate`, `Swap`, `2-Opt`) no cambian el fitness con el `SPLIT` vigente
- los movimientos que sí cambian la solución real hoy son los que modifican membresía: `Delete`, `Add`, `SwapOut`

La decisión arquitectónica vigente es mantener el `GiantTour` por coherencia genética y validación, pero activar en producción solo los operadores que cambian el conjunto de envíos.

---

## Factibilidad interna vs validación estricta

La arquitectura actual distingue dos capas de chequeo:

### Factibilidad interna del individuo

Se concentra en `Individuo.validarFactibilidad()` y en la partición de `Poblacion` entre factibles e infactibles. Revisa principalmente:

- giant tour no nulo ni duplicado
- consistencia entre `representacionGigante`, `enviosAsignados` y `enviosNoAsignados`
- must-go no asignados
- rutas `ruta.esFactible()`
- violaciones agregadas de capacidad, tiempo y almacén iguales a cero

### Validación estricta de la solución

Se concentra en `Validador.validarIndividuo(...)`, que además reporta explícitamente:

- rutas desconectadas
- deadlines violados
- capacidad excedida por vuelo
- almacenes excedidos
- envíos asignados fuera del giant tour
- envíos simultáneamente asignados y no asignados

### Implicación para los algoritmos

- `DHGSAlgorithm` intenta reparar soluciones no estrictamente factibles con `repararHaciaFactibilidad(...)` y al retorno prioriza la factibilidad estricta con `seleccionarMejorRetorno(...)`.
- `IALNSAlgorithm` evalúa cada candidato mediante `IALNSContext`, que a su vez usa `CalculadorFitness` y `Validador` sobre el mismo dominio compartido.

---

## Comportamiento algorítmico por metaheurística

### DHGS

- población inicial con soluciones greedy, must-go y aleatorias
- crossover `OXCrossover`
- búsqueda local enfocada en cambiar membresía del giant tour
- intento de reparación hacia factibilidad estricta
- selección final priorizando factibilidad estricta y luego fitness

### IALNS

- solución inicial generada con `ConstructorSolucionesIniciales`
- normalización de cobertura completa del giant tour
- destroy/repair adaptativo con pesos
- aceptación con criterio estilo simulated annealing
- ajuste dinámico de `factorQ` según mejora observada

---

## Restricciones activas en este alcance

El sistema actualmente evalúa:

- capacidad de vuelo por maletas agregadas
- deadline del envío
- continuidad temporal de la ruta
- carga remanente en almacenes por aeropuerto
- penalización por no asignados

### Detalle lógico de maletas y capacidades

#### Vuelos

- `GrafoVuelos` descarta vuelos cuya `capacidadDisponible` no alcance para el envío individual
- `CalculadorFitness` recalcula la carga total por vuelo sumando las maletas de todos los envíos asignados
- `Validador` reporta explícitamente cuando esa suma excede la capacidad del vuelo

Esto hace que la factibilidad agregada de capacidad se verifique al nivel del individuo completo, no solo por envío aislado.

#### Almacenes

- `SimuladorEpocas` mantiene `AlmacenEstado` global por aeropuerto
- cuando un envío llega a una época, sus maletas se registran en el almacén origen
- cuando el envío es despachado, esas maletas se remueven del almacén origen
- durante la optimización, los envíos no asignados representan la carga que permanece ocupando almacén
- `CalculadorFitness` penaliza el exceso cuadrático de almacén y `Validador` lo convierte en observación explícita

Por tanto, la unidad física que atraviesa toda la arquitectura es la **maleta**, no solo el conteo de envíos.

## Restricciones fuera de alcance por ahora

En este estado del sistema **no** se procesan:

- cancelaciones de vuelos
- replanificación por disrupciones
- estados operativos dinámicos por incidente

---

## Estrategia de pruebas alineada al estado actual

### Unitarias / integración ligera
- `DomainModelTests`
- `SimuladorEpocasTest`
- `LocalSearchConsistencyTest`
- `DHGSInstanciasDiariasTest`
- `DHGSIntegrationTest`
- `IALNSIntegrationTest`

### Datos reales opt-in
- `DHGSExperimentacionNumericaTest`
  - escenarios de **3, 5 y 7 días**
  - configuración leída desde `test-experiment.properties`
  - marcado con `slow-experiment`
- `IALNSExperimentacionNumericaTest`
  - escenarios de **3, 5 y 7 días**
  - configuración leída desde `test-experiment.properties`
  - marcado con `slow-experiment`

El `pom.xml` excluye por defecto `slow-experiment` en `maven-surefire-plugin`. Para incluir estas pruebas manualmente se usa el perfil `with-experiments`.

Estas pruebas reflejan el estado funcional vigente del proyecto y separan explícitamente validación cotidiana de experimentación pesada.
