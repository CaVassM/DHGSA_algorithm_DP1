# Arquitectura — Tasf.B2B DHGS

## Resumen arquitectónico actual

El sistema se encuentra en un primer alcance estable con las siguientes decisiones:

- horizonte de simulación **configurable por escenario**
- partición temporal en épocas de **4 horas**
- `Vuelo` como **plantilla recurrente**
- `InstanciaVuelo` como **ocurrencia diaria materializada**
- optimización por época mediante **DHGS** o **IALNS**
- operación en **condiciones ideales**, sin cancelaciones ni disrupciones
- la suite numérica de referencia usa escenarios de **3, 5 y 7 días** configurados desde `test-experiment.properties`
- ambas metaheurísticas comparten **el mismo dominio, simulación temporal, restricciones y datos de entrada**, pero permanecen **separadas internamente**

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
4. ejecutar DHGS en una foto temporal del sistema

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

## Pruebas alineadas al estado actual

### Unitarias / integración ligera
- `DomainModelTests`
- `SimuladorEpocasTest`
- `LocalSearchConsistencyTest`
- `DHGSInstanciasDiariasTest`
- `DHGSIntegrationTest`

### Datos reales
- `DHGSExperimentacionNumericaTest`
  - escenario DHGS con **3 días**
  - escenario DHGS con **5 días**
  - escenario DHGS con **7 días**
  - fecha de inicio y parámetros leídos desde `test-experiment.properties`
  - total de épocas derivado automáticamente del escenario activo

Estas pruebas reflejan el estado funcional vigente del proyecto.
