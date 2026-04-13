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

# Ejecutar solo el test de carga de datos
./mvnw test -Dtest=IngestionCargaDatosTest

# Ejecutar solo la simulación completa del algoritmo
./mvnw test -Dtest=DHGSIntegrationTest
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
│   │   │   └── Poblacion      ← Gestión de población
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
│   │   │   ├── Aeropuerto     ← Nodo del grafo
│   │   │   ├── Vuelo          ← Arco del grafo
│   │   │   ├── Envio          ← Solicitud de transporte
│   │   │   ├── RutaEnvio      ← Secuencia de vuelos asignada
│   │   │   └── AlmacenEstado  ← Estado de almacén
│   │   ├── service/           ← Lógica de simulación
│   │   │   ├── SimuladorEpocas
│   │   │   └── EpocaData
│   │   └── valueobject/       ← Objetos de valor
│   │       ├── Coordenada
│   │       └── ParametrosPenalizacion
│   └── infraestructure/
│       ├── ingestion/         ← Parsers de datos
│       │   ├── AeropuertoParser
│       │   ├── VueloParser
│       │   └── EnvioParser
│       └── util/              ← Utilidades algorítmicas
│           ├── GrafoVuelos         ← Grafo + Dijkstra
│           ├── AlgoritmoSPLIT      ← Asignación envío→ruta
│           ├── CalculadorFitness   ← Función objetivo
│           ├── ConstructorSolucionesIniciales
│           └── Validador
│
├── test/
│   ├── java/.../
│   │   ├── ingestion/IngestionCargaDatosTest   ← Carga de datos
│   │   ├── algorithm/DHGSIntegrationTest       ← Simulación completa
│   │   └── domain/model/DomainModelTests       ← Tests unitarios
│   └── resources/
│       ├── test-ingestion.properties           ← Rutas de archivos
│       └── datos/
│           ├── estudiantes.txt                 ← Aeropuertos
│           ├── planes_vuelo.txt                ← Vuelos
│           └── envios_preliminar/              ← Envíos por aeropuerto
│               ├── envios_SKBO_.txt
│               ├── envios_SEQM_.txt
│               └── envios_SPIM_.txt
```

---

## Formato de Datos de Entrada

### Aeropuertos (`estudiantes.txt`)
```
01 SKBO Bogota Colombia bogo -5 430 Latitud: 04° 42' 05" N Longitud: 74° 08' 49" W
```
Campos: `ID  ICAO  Ciudad  País  CódigoCorto  GMT  CapacidadAlmacén  Coordenadas`

### Vuelos (`planes_vuelo.txt`)
```
SKBO-SEQM-03:34-04:21-0300
```
Campos: `Origen-Destino-HoraSalida-HoraLlegada-Capacidad`

### Envíos (`envios_XXXX_.txt`)
```
00000001-20260102-00-47-SEQM-002-0032535
```
Campos: `ID-Fecha-Hora-Min-Destino-Maletas-Cliente`  
El aeropuerto **origen** se infiere del nombre del archivo.

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

---

## Ejecución de la Simulación

La simulación corre como **test de integración** (`DHGSIntegrationTest`):

1. Carga 7 aeropuertos, 15 vuelos, 14 envíos desde archivos
2. Construye grafo de vuelos con distancias Haversine
3. Ejecuta DHGS (población=25, límite=10s)
4. Imprime resultado: rutas asignadas, costos, violaciones

Ejemplo de salida:
```
RESULTADO DHGS
  Envíos asignados:    9
  Envíos no asignados: 5
  Fitness:             253630.25
  Factible:            true

RUTAS ASIGNADAS
  [00000001] SKBO→SEQM (2 maletas) vía: SKBO→SEQM | dist=712 km
  [00000003] SKBO→SCEL (10 maletas) vía: SKBO→SCEL | dist=4251 km
  ...
```

---

## Documentación Adicional

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — Diagrama de arquitectura y flujo
- [`PSEUDOCODE.md`](PSEUDOCODE.md) — Pseudocódigo del algoritmo DHGS

