# Arquitectura — Tasf.B2B DHGS

## Diagrama de Capas

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION                                 │
│   controller/          (API REST — futuro)                          │
├─────────────────────────────────────────────────────────────────────┤
│                        APPLICATION                                  │
│   service/             OptimizationService                          │
│   dto/                 Request/Response DTOs                        │
├─────────────────────────────────────────────────────────────────────┤
│                          DOMAIN                                     │
│                                                                     │
│   model/               Aeropuerto, Vuelo, Envio, RutaEnvio,        │
│                        AlmacenEstado                                │
│                                                                     │
│   service/             SimuladorEpocas, EpocaData                   │
│                                                                     │
│   valueobject/         Coordenada, ParametrosPenalizacion           │
├─────────────────────────────────────────────────────────────────────┤
│                       ALGORITHM                                     │
│                                                                     │
│   dhgs/                DHGSAlgorithm ← orquestador                  │
│                        Individuo     ← solución candidata           │
│                        Poblacion     ← gestión evolutiva            │
│                        FitnessEvaluator                             │
│                                                                     │
│   operators/           OXCrossover                                  │
│                        LocalSearchDelete, Add, SwapOut              │
│                        LocalSearchSwap, Relocate, 2Opt              │
│                        LocalSearchContext                           │
├─────────────────────────────────────────────────────────────────────┤
│                      INFRASTRUCTURE                                 │
│                                                                     │
│   ingestion/           AeropuertoParser, VueloParser, EnvioParser   │
│                                                                     │
│   util/                GrafoVuelos (Dijkstra)                       │
│                        AlgoritmoSPLIT                               │
│                        CalculadorFitness                            │
│                        ConstructorSolucionesIniciales                │
│                        Validador                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Flujo de Datos Completo

```
                    ┌──────────────────┐
                    │  ARCHIVOS DATOS  │
                    │                  │
                    │ estudiantes.txt  │
                    │ planes_vuelo.txt │
                    │ envios_XXXX_.txt │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │     PARSERS      │
                    │                  │
                    │ AeropuertoParser │
                    │ VueloParser      │
                    │ EnvioParser      │
                    └────────┬─────────┘
                             │
              ┌──────────────▼──────────────┐
              │       GRAFO DE VUELOS       │
              │                             │
              │  Nodos = Aeropuertos (ICAO) │
              │  Arcos = Vuelos programados │
              │  Peso  = Duración (min)     │
              │  + Matriz distancias (km)   │
              └──────────────┬──────────────┘
                             │
              ┌──────────────▼──────────────┐
              │    SIMULADOR DE ÉPOCAS      │
              │                             │
              │  Divide tiempo en ventanas  │
              │  de 4 horas. Por cada una:  │
              │                             │
              │  1. Preparar envíos         │
              │  2. Actualizar must-go      │
              │  3. Ejecutar DHGS ──────────┼──────────────┐
              │  4. Procesar resultado      │              │
              └──────────────┬──────────────┘              │
                             │                             │
                             │              ┌──────────────▼──────────────┐
                             │              │      ALGORITMO DHGS        │
                             │              │                             │
                             │              │  ┌─────────────────────┐   │
                             │              │  │ POBLACIÓN INICIAL   │   │
                             │              │  │ Greedy + Lazy +     │   │
                             │              │  │ Aleatorias          │   │
                             │              │  └─────────┬───────────┘   │
                             │              │            │               │
                             │              │  ┌─────────▼───────────┐   │
                             │              │  │  LOOP GENÉTICO      │   │
                             │              │  │                     │   │
                             │              │  │  1. Selección       │   │
                             │              │  │     (torneo binario)│   │
                             │              │  │          │          │   │
                             │              │  │  2. Crossover (OX)  │   │
                             │              │  │          │          │   │
                             │              │  │  3. SPLIT           │   │
                             │              │  │     (Dijkstra)      │   │
                             │              │  │          │          │   │
                             │              │  │  4. Local Search    │   │
                             │              │  │     DELETE          │   │
                             │              │  │     ADD             │   │
                             │              │  │     SWAP-OUT        │   │
                             │              │  │     RELOCATE        │   │
                             │              │  │     SWAP            │   │
                             │              │  │     2-OPT           │   │
                             │              │  │          │          │   │
                             │              │  │  5. Evaluación      │   │
                             │              │  │     (fitness)       │   │
                             │              │  │          │          │   │
                             │              │  │  6. Gestión         │   │
                             │              │  │     población       │   │
                             │              │  │          │          │   │
                             │              │  │  7. Ajuste          │   │
                             │              │  │     penalizaciones  │   │
                             │              │  └─────────┬───────────┘   │
                             │              │            │               │
                             │              │  ┌─────────▼───────────┐   │
                             │              │  │  MEJOR SOLUCIÓN     │   │
                             │              │  │  Individuo factible │   │
                             │              │  │  con menor fitness  │   │
                             │              │  └─────────────────────┘   │
                             │              └──────────────┬──────────────┘
                             │                             │
              ┌──────────────▼──────────────┐              │
              │       RESULTADO             │◄─────────────┘
              │                             │
              │  • Envíos asignados         │
              │    (envío → ruta de vuelos) │
              │  • Envíos postponidos       │
              │  • Costo total              │
              │  • Violaciones              │
              └─────────────────────────────┘
```

---

## Estructura de un Individuo (Solución)

```
Individuo
├── id: String
├── epoca: int
│
├── representacionGigante: List<Envio>     ← Giant Tour (permutación)
│
├── enviosAsignados: Map<Envio, RutaEnvio> ← Resultado del SPLIT
│   ├── Envio₁ → RutaEnvio [SKBO→SEQM]
│   ├── Envio₂ → RutaEnvio [SKBO→SPIM→SCEL]
│   └── ...
│
├── enviosNoAsignados: List<Envio>         ← Sin ruta / postponidos
│
├── Métricas:
│   ├── fitness: double                    ← Valor objetivo (menor=mejor)
│   ├── costoDistanciaTotal: double
│   ├── violacionesCapacidad: double       ← Σ max(0, carga−cap)²
│   ├── violacionesTiempo: double          ← Σ max(0, retraso)²
│   └── lateness: double                   ← Σ retraso (lineal)
│
└── esFactible: boolean                    ← Sin violaciones duras
```

---

## Gestión de Población

```
Poblacion
├── factibles: List<Individuo>    (máx 25)  ← Soluciones válidas
├── infactibles: List<Individuo>  (máx 25)  ← Soluciones con violaciones
├── mejorHistorico: Individuo               ← Mejor factible encontrado
└── diversidad: double                      ← Desviación estándar fitness

Reglas:
• Al agregar: si factible → actualiza mejorHistorico si es mejor
• Si excede tamaño → elimina el peor (mayor fitness)
• Selección: torneo binario sobre ambas subpoblaciones
```

---

## Operadores de Búsqueda Local

| Operador | Tipo | Qué hace | Cuándo mejora |
|----------|------|----------|---------------|
| **DELETE** | DHGS | Remueve opcionales asignados | Vuelo sobrecargado |
| **ADD** | DHGS | Inserta no-asignados vía SPLIT | Hay capacidad libre |
| **SWAP-OUT** | DHGS | Intercambia dentro↔fuera | Reemplaza envío caro por barato |
| **SWAP** | HGS | Intercambia posiciones en giant tour | Mejor orden para SPLIT |
| **RELOCATE** | HGS | Mueve envío a otra posición | Mejor agrupación |
| **2-OPT** | HGS | Invierte segmento del tour | Reduce distancia total |

Todos usan **first-improvement**: aceptan el primer movimiento que mejora y reinician.

