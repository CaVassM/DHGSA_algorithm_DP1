# Tasf.B2B — DHGS: Asignación Óptima de Maletas a Vuelos

Sistema de optimización logística que asigna envíos de maletas a secuencias de vuelos comerciales, minimizando costo total y respetando restricciones de capacidad y tiempo.

Basado en el algoritmo **DHGS (Dynamic Hybrid Genetic Search)**.

---

## Requisitos

| Herramienta | Versión mínima |
|-------------|---------------|
| Java        | 21            |
| Maven       | 3.9+ (incluido via `mvnw`) |

No se requiere base de datos ni servicios externos.

---

## Inicio Rápido

```bash
# Clonar / descomprimir el proyecto
cd demo

# Compilar y ejecutar todos los tests (incluye simulación DHGS)
./mvnw clean test

# Ejecutar solo el test de carga de datos de prueba
./mvnw test -Dtest=IngestionCargaDatosTest

# Ejecutar solo el test de carga de datos reales
./mvnw test -Dtest=IngestionDatosRealesTest

# Ejecutar la simulación DHGS con datos de prueba
./mvnw test -Dtest=DHGSIntegrationTest

# Ejecutar la simulación DHGS con datos reales
./mvnw test -Dtest=DHGSRealDataTest
```

---

## Estructura del Proyecto

```
src/
├── main/java/com/TasfB2B/DHGS/demo/
│   ├── algorithm/
│   │   ├── dhgs/              ← Núcleo del algoritmo genético
│   │   │   ├── DHGSAlgorithm  ← Orquestador principal
│   │   │   ├── Individuo      ← Solución candidata
│   │   │   ├── Poblacion      ← Gestión de población
│   │   │   └── FitnessEvaluator (legacy, no usado por el flujo actual)
│   │   └── operators/         ← Operadores genéticos
│   │       ├── OXCrossover          ← Cruce ordenado
│   │       ├── LocalSearchDelete    ← Remover envíos problemáticos
│   │       ├── LocalSearchAdd       ← Insertar envíos no asignados
│   │       ├── LocalSearchSwapOut   ← Intercambiar dentro/fuera
│   │       ├── LocalSearchSwap      ← Intercambiar posiciones
│   │       ├── LocalSearchRelocate  ← Reubicar en giant tour
│   │       └── LocalSearch2Opt      ← Inversión de segmento
│   ├── domain/
│   │   ├── model/             ← Entidades de negocio
│   │   │   ├── Aeropuerto     ← Nodo del grafo (Haversine)
│   │   │   ├── Vuelo          ← Arco del grafo
│   │   │   ├── Envio          ← Solicitud de transporte
│   │   │   ├── RutaEnvio      ← Secuencia de vuelos asignada
│   │   │   └── AlmacenEstado  ← Estado de almacén
│   │   ├── service/           ← Lógica de simulación
│   │   │   ├── SimuladorEpocas
│   │   │   └── EpocaData
│   │   └── valueobject/       ← Objetos de valor
│   │       ├── Coordenada     ← Parser DMS a decimal
│   │       └── ParametrosPenalizacion
│   └── infraestructure/
│       ├── ingestion/         ← Parsers de datos
│       │   ├── AeropuertoParser  ← Soporta UTF-8 y UTF-16 BE
│       │   ├── VueloParser
│       │   └── EnvioParser       ← Soporta envios_ y _envios_ prefijos
│       └── util/              ← Utilidades algorítmicas
│           ├── GrafoVuelos         ← Grafo + Dijkstra
│           ├── AlgoritmoSPLIT      ← Asignación envío→ruta
│           ├── CalculadorFitness   ← Función objetivo
│           ├── ConstructorSolucionesIniciales
│           └── Validador
│
├── test/
│   ├── java/.../
│   │   ├── ingestion/
│   │   │   ├── IngestionCargaDatosTest      ← Datos de prueba (7 aerop, 15 vuelos, 14 envíos)
│   │   │   └── IngestionDatosRealesTest     ← Datos reales (30 aerop, 2866 vuelos, ~9M envíos)
│   │   ├── algorithm/
│   │   │   ├── DHGSIntegrationTest          ← DHGS con datos de prueba
│   │   │   └── DHGSRealDataTest             ← DHGS con datos reales (muestreo)
│   │   └── domain/model/DomainModelTests    ← Tests unitarios
│   └── resources/
│       ├── test-ingestion.properties        ← Rutas de archivos (test + real)
│       └── datos/
│           ├── estudiantes.txt              ← 7 aeropuertos (prueba)
│           ├── estudiantes_real.txt         ← 30 aeropuertos (real, UTF-16 BE)
│           ├── planes_vuelo.txt             ← 15 vuelos (prueba)
│           ├── planes_vuelo_real.txt        ← 2866 vuelos (real)
│           ├── envios_preliminar_test/      ← 3 archivos envíos (prueba, 14 total)
│           │   ├── envios_SKBO_.txt
│           │   ├── envios_SEQM_.txt
│           │   └── envios_SPIM_.txt
│           └── envios_preliminar/           ← 30 archivos envíos (real, ~9M total)
│               ├── _envios_SKBO_.txt        (380k envíos)
│               ├── _envios_SBBR_.txt        (459k envíos)
│               └── ... (30 archivos, uno por aeropuerto)
```

---

## Datasets

### Datos de Prueba (test)
| Recurso | Archivo | Cantidad |
|---------|---------|----------|
| Aeropuertos | `estudiantes.txt` | 7 (solo Sudamérica) |
| Vuelos | `planes_vuelo.txt` | 15 |
| Envíos | `envios_preliminar_test/` | 14 (3 archivos) |

### Datos Reales (real)
| Recurso | Archivo | Cantidad |
|---------|---------|----------|
| Aeropuertos | `estudiantes_real.txt` | 30 (Sudamérica + Europa + Asia) |
| Vuelos | `planes_vuelo_real.txt` | 2,866 |
| Envíos | `envios_preliminar/` | ~9.5M (30 archivos, ~300k c/u) |

---

## Formato de Datos de Entrada

### Aeropuertos (`estudiantes.txt` / `estudiantes_real.txt`)
```
01 SKBO Bogota Colombia bogo -5 430 Latitud: 04° 42' 05" N Longitud: 74° 08' 49" W
```
Campos: `ID  ICAO  Ciudad  País  CódigoCorto  GMT  CapacidadAlmacén  Coordenadas`

> **Nota**: El archivo real usa `Latitude:`/`Longitude:` y encoding UTF-16 BE. El parser detecta ambos formatos automáticamente.

### Vuelos (`planes_vuelo.txt` / `planes_vuelo_real.txt`)
```
SKBO-SEQM-03:34-04:21-0300
```
Campos: `Origen-Destino-HoraSalida-HoraLlegada-Capacidad`

### Envíos (`envios_XXXX_.txt` / `_envios_XXXX_.txt`)
```
00000001-20260102-00-47-SEQM-002-0032535
```
Campos: `ID-Fecha-Hora-Min-Destino-Maletas-Cliente`
El aeropuerto **origen** se infiere del nombre del archivo.

> **Nota**: Los archivos de prueba usan prefijo `envios_`, los reales `_envios_`. El parser extrae el código ICAO de 4 letras del nombre.

---

## Función de Fitness

```
fitness = distanciaTotal
        + 1000 × Σ max(0, maletasAsignadas − capacidadVuelo)²
        + 5000 × Σ max(0, tiempoLlegada − deadline)²
        + penalización por envíos no asignados
```

- **Menor fitness = mejor solución**
- Penalización cuadrática: violaciones grandes se castigan exponencialmente
- Must-go no asignados reciben penalización 10× mayor que opcionales

> **Importante**: el fitness operativo del proyecto se calcula en `CalculadorFitness`.
> El método `Individuo.calcularFitness(...)` y la clase `FitnessEvaluator` se conservan
> como referencias legacy/experimentales y **no** participan en la ejecución real de
> `DHGSAlgorithm` ni en los tests actuales.

### Resultados observados

| Dataset | Envíos | Asignados | Fitness | Factible | Violaciones |
|---------|--------|-----------|---------|----------|-------------|
| Prueba (14) | 14 | 3 | 21,273 | ✅ | 0 |
| Real (50 muestreo) | 50 | 29 | 453,596 | ✅ | 0 |
| Real (200 greedy) | 200 | 200 | ~2.5M | — | — |

---

## Ejecución de la Simulación

### Con datos de prueba (`DHGSIntegrationTest`)
1. Carga 7 aeropuertos, 15 vuelos, 14 envíos
2. Construye grafo de vuelos con distancias Haversine
3. Ejecuta DHGS (población=25, límite=10s)
4. Imprime resultado: rutas asignadas, costos, violaciones

### Con datos reales (`DHGSRealDataTest`)
1. Carga 30 aeropuertos, 2866 vuelos, muestreo de envíos (~50-200)
2. Grafo de 30 nodos y 2866 arcos, conectividad 100%
3. Ejecuta DHGS con muestreo progresivo (50 y 200 envíos)
4. Verifica coherencia del fitness entre escalas
5. Valida factibilidad y ausencia de violaciones

---

## Documentación Adicional

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Diagrama de arquitectura y flujo
- [`PSEUDOCODE.md`](PSEUDOCODE.md) — Pseudocódigo del algoritmo DHGS

