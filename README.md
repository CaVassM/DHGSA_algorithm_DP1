# Tasf.B2B — DHGS para asignación de envíos a vuelos

Sistema de planificación logística que asigna envíos de maletas a rutas aéreas usando **DHGS (Dynamic Hybrid Genetic Search)** sobre un horizonte configurable. La experimentación numérica de referencia quedó automatizada en escenarios de **3, 5 y 7 días**.

## Estado actual del sistema

El proyecto quedó alineado al siguiente alcance:

- simulación configurable por duración; la experimentación numérica de referencia usa **3, 5 y 7 días**
- épocas de **4 horas**
- vuelos recurrentes diarios materializados como **`InstanciaVuelo`**
- ruteo temporal sobre fechas absolutas de salida y llegada
- operación en **condiciones ideales**, sin cancelaciones ni disrupciones
- pruebas de datos reales enfocadas en **experimentación numérica con ventanas reales de 3, 5 y 7 días**

## Qué optimiza realmente el algoritmo hoy

En el estado actual, DHGS **sí optimiza**, pero conviene ser preciso sobre **qué** está optimizando:

1. **selección de qué envíos despachar en la época**
2. **elección de la mejor ruta temporal por envío** usando `AlgoritmoSPLIT` + `GrafoVuelos`
3. **reducción del costo total** medido como `distancia × maletas`
4. **reducción de penalizaciones** por:
   - exceso de capacidad en vuelos
   - retrasos respecto al deadline
   - exceso de almacén por aeropuerto
   - envíos no asignados

### Importante sobre `GiantTour`

`representacionGigante` **sí tiene coherencia estructural**, pero su papel actual es principalmente:

- representación genética para `OXCrossover`
- soporte de consistencia entre `enviosAsignados` y `enviosNoAsignados`
- rastro explícito de qué envíos pertenecen a la solución

Con el `SPLIT` vigente, la ruta de un envío se calcula **de forma independiente** del orden del tour. Por eso, hoy el orden del `GiantTour` **no cambia** la ruta elegida para un mismo conjunto de envíos; lo que sí cambia la solución es **agregar, quitar o sustituir envíos**.

Por esa razón, en el algoritmo principal quedaron activos solo los operadores locales que sí alteran el conjunto de envíos:

- `LocalSearchDelete`
- `LocalSearchAdd`
- `LocalSearchSwapOut`

Los operadores de reordenamiento (`Relocate`, `Swap`, `2-Opt`) se conservan en el código para una etapa futura en la que `SPLIT` sea sensible al orden.

Esta conclusión ya no se apoya solo en inspección visual del código: `LocalSearchConsistencyTest` verifica explícitamente que con el `SPLIT` actual los operadores de reordenamiento no mejoran ni fitness ni asignaciones sobre un caso controlado.

## Requisitos

| Herramienta | Versión |
|---|---:|
| Java | 21 |
| Maven | Wrapper incluido (`mvnw`) |

## Ejecución rápida

### Compilar el proyecto

```bash
./mvnw clean compile
```

```powershell
.\mvnw.cmd clean compile
```

### Ejecutar toda la suite

```bash
./mvnw clean test
```

```powershell
.\mvnw.cmd clean test
```

### Ejecutar solo las pruebas principales de algoritmo

```bash
./mvnw -Dtest=DHGSIntegrationTest,DHGSInstanciasDiariasTest,DHGSExperimentacionNumericaTest test
```

```powershell
.\mvnw.cmd -Dtest=DHGSIntegrationTest,DHGSInstanciasDiariasTest,DHGSExperimentacionNumericaTest test
```

### Ejecutar solo la experimentación numérica del algoritmo DHGS

```bash
./mvnw -Dtest=DHGSExperimentacionNumericaTest test
```

```powershell
.\mvnw.cmd -Dtest=DHGSExperimentacionNumericaTest test
```

> `DHGSExperimentacionNumericaTest` es la suite de referencia para experimentación numérica: ejecuta tres escenarios reproducibles (**3**, **5** y **7** días) y toma su configuración desde `src/test/resources/test-experiment.properties`.

## Estructura relevante

```text
src/main/java/com/TasfB2B/DHGS/demo/
├── algorithm/
│   ├── dhgs/
│   │   ├── DHGSAlgorithm
│   │   ├── Individuo
│   │   └── Poblacion
│   └── operators/
├── application/
│   ├── dto/
│   └── service/OptimizationService
├── domain/
│   ├── model/
│   │   ├── Aeropuerto
│   │   ├── Vuelo                (plantilla recurrente)
│   │   ├── InstanciaVuelo       (ocurrencia diaria materializada)
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

### 1. Horizonte de simulación

- inicio: fecha indicada por el usuario o día anterior al primer envío
- duración: configurable según el escenario
- granularidad: **4 horas por época**
- total: `duraciónEnDías × 6` épocas

### 2. Vuelos recurrentes

`Vuelo` representa la plantilla recurrente.

Antes de optimizar, `GrafoVuelos` materializa cada plantilla en tantas ocurrencias diarias de tipo `InstanciaVuelo` como días tenga el escenario configurado.

Ejemplo:

- plantilla: `SKBO -> SPIM`, salida `06:00`, llegada `08:15`
- instancias generadas:
  - `VL-...@2026-01-01`
  - `VL-...@2026-01-02`
  - `VL-...@2026-01-03`
  - `VL-...@2026-01-04`
  - `VL-...@2026-01-05`

### 3. Envíos

Cada envío:

- tiene `fechaHoraCreacion`
- entra a la época correspondiente
- calcula deadline
- actualiza `must-go` y prioridad en cada época
- aporta `cantidadMaletas`, que afecta costo, factibilidad de vuelo y ocupación de almacén

## Flujo actual

1. Se parsean aeropuertos, vuelos plantilla y envíos.
2. `SimuladorEpocas` genera las épocas del horizonte configurado.
3. `GrafoVuelos` materializa vuelos diarios para los días del escenario activo.
4. En cada época:
   - se mezclan envíos nuevos y pendientes
   - se recalculan prioridad y `must-go`
   - DHGS genera y mejora soluciones
   - se despachan envíos asignados y se postergan no asignados
5. Se consolida el resultado final por época y total.

## Cómo entran maletas, vuelos y almacenes en la lógica

### Maletas

- cada `Envio` tiene `cantidadMaletas`
- el costo de una `RutaEnvio` es `distanciaTotal × cantidadMaletas`
- la carga de cada vuelo se calcula sumando las maletas de todos los envíos que usan ese vuelo
- la carga de almacén se calcula sumando las maletas de los envíos no asignados que permanecen en el aeropuerto origen

### Capacidad de vuelos

Durante la optimización de una época:

- `GrafoVuelos` filtra vuelos cuya `capacidadDisponible` individual sea insuficiente para **ese envío**
- luego `CalculadorFitness` y `Validador` revisan la **sobrecarga agregada** por vuelo sumando maletas de todos los envíos asignados

Esto significa que la capacidad de vuelo hoy se trata de forma **ex post** a nivel agregado: la solución puede construirse y luego recibir penalización si varias asignaciones usan el mismo vuelo por encima de su capacidad total.

### Almacén por aeropuerto

El proyecto **sí** toma en cuenta almacenes:

- `SimuladorEpocas` mantiene `AlmacenEstado` por aeropuerto a lo largo de las épocas
- al llegar envíos nuevos, sus maletas se agregan al almacén origen
- al despachar un envío, sus maletas salen del almacén origen
- durante la optimización, `CalculadorFitness` penaliza el exceso de almacén usando las maletas de los envíos no asignados
- `Validador` también reporta explícitamente si un aeropuerto supera su capacidad de almacén

En otras palabras, el criterio de almacén vigente es: **las maletas que no salen en la época siguen ocupando espacio en el aeropuerto de origen**.

## Pruebas actuales

### Unitarias / integración ligera

- `SimuladorEpocasTest`
- `DomainModelTests`
- `LocalSearchConsistencyTest`
- `DHGSInstanciasDiariasTest`
- `DHGSIntegrationTest`

### Datos reales

- `DHGSExperimentacionNumericaTest`
  - escenario 1: **3 días**
  - escenario 2: **5 días**
  - escenario 3: **7 días**
  - configuración cargada desde `test-experiment.properties`
  - parámetros activos: fecha de inicio, duración por escenario, tamaño de población, límite por época y conteos esperados
  - imprime tiempos de carga/filtrado, simulación y tiempo total por escenario

## Qué no incluye este alcance

Actualmente el sistema **no** modela:

- cancelaciones de vuelos
- disrupciones durante la simulación
- replanificación por eventos operativos

La base quedó preparada para eso en una siguiente iteración gracias al uso de `InstanciaVuelo`.

## Documentación complementaria

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`PSEUDOCODE.md`](PSEUDOCODE.md)
- [`RESULTS.md`](RESULTS.md)
- [`HELP.md`](HELP.md)
