# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Descripción del proyecto

Tasf.B2B es un sistema de planificación de equipajes extraviados entre aeropuertos. Se implementan dos metaheurísticas — **DHGS** (genético híbrido) e **IALNS** (ALNS adaptativo + simulated annealing) — que comparten dominio, simulación temporal por épocas y validador, pero operan internamente separadas. Cada época cubre 4h y se optimiza independientemente sobre una "foto" del sistema.

Estado actual: el repo está migrando a una arquitectura modular. La lógica del algoritmo vive en `modules/backend/src/main/java/com/tasfb2b/dhgs/demo/...` (capas domain/algorithm/infraestructure). El paquete nuevo `com/tasfb2b/backend/...` contiene el esqueleto MVC (controller/service/repository) que aún no está cableado a la lógica del algoritmo.

## Stack

- **Java 21** (toolchain), **Spring Boot 3.3.5**, Spring MVC + WebSocket + Validation, JPA API, Lombok
- **Maven** multimódulo: parent `tasf-b2b-parent` agrega `modules/backend`. El frontend (`modules/frontend`) tiene `package.json`/`tsconfig.json` pero está vacío (no hace falta tocarlo todavía).
- **Docker Compose**: PostgreSQL 15, Redis 7, MongoDB 7. **El backend se ejecuta fuera de Docker**, solo los servicios de datos están containerizados.
- Configuración local vía `.env` (copiar de `.env.example`).

## Estructura clave

```
modules/backend/src/main/java/com/tasfb2b/
├── backend/                       ← esqueleto MVC nuevo (Spring layer)
│   ├── controller/PlanningController.java   (POST /api/v1/planner/runs)
│   ├── service/PlanningService.java
│   ├── dto/{request,response}/
│   ├── domain/{enums,model}/      (PlannerAlgorithm, OperationalScenario, ShipmentEntity)
│   └── exception/GlobalExceptionHandler.java
└── dhgs/demo/                     ← código legado del algoritmo (núcleo funcional)
    ├── application/
    │   ├── service/OptimizationService.java   ← orquesta el flujo end-to-end
    │   └── dto/                                (OptimizationRequest/Response, RutaDTO, EpocaResumenDTO)
    ├── domain/
    │   ├── model/                  Aeropuerto, Vuelo (plantilla), InstanciaVuelo (ocurrencia
    │   │                           diaria), Envio, RutaEnvio, AlmacenEstado
    │   ├── service/                SimuladorEpocas, EpocaData
    │   └── valueobject/            Coordenada, ParametrosPenalizacion
    ├── algorithm/
    │   ├── dhgs/                   DHGSAlgorithm, Individuo, Poblacion, FitnessEvaluator
    │   ├── ialns/                  IALNSAlgorithm, IALNSContext, IALNSState
    │   │   └── operators/{destroy,repair}/   (5 destroy + 5 repair)
    │   └── operators/              OXCrossover + LocalSearch{Add,Delete,SwapOut,Relocate,Swap,2Opt}
    └── infraestructure/
        ├── ingestion/              AeropuertoParser, VueloParser, EnvioParser
        └── util/                   GrafoVuelos, AlgoritmoSPLIT, CalculadorFitness,
                                    ConstructorSolucionesIniciales, Validador
```

Documentación: `ARCHITECTURE.md` (capas, modelo temporal, factibilidad), `PSEUDOCODE.md`, `RESULTS.md`, `docs/PLANIFICADOR_EXPLICADO_SIMPLE.md`, `docs/CONTEXTO_DATOS.md` (entidades de la BD y reglas de negocio extraídas).

## Cómo correr el proyecto localmente

1. `cp .env.example .env` (Windows: `Copy-Item .env.example .env`)
2. Levantar servicios de datos: `docker-compose up -d`
3. Compilar y ejecutar el backend (desde la raíz):
   - `./mvnw -pl modules/backend spring-boot:run` (Linux/Mac)
   - `mvnw.cmd -pl modules/backend spring-boot:run` (Windows)
4. Backend escucha en `http://localhost:8080` (`/api/v1/planner/health`).

El parent compila los módulos a la par (`<modules>` en `pom.xml` raíz). No usar `cd modules/backend` salvo necesidad.

## Tests

- **Suite normal** (rápida): `./mvnw -pl modules/backend test`
- **Tests de experimentación pesada** (datos reales, escenarios 3/5/7 días): marcados con JUnit `@Tag("slow-experiment")` y **excluidos por defecto** vía `surefire.excludedGroups`. Para incluirlos:
  - `./mvnw -pl modules/backend test -Pwith-experiments`
- **Un test específico**: `./mvnw -pl modules/backend test -Dtest=DHGSIntegrationTest`
- **Un método**: `./mvnw -pl modules/backend test -Dtest=DHGSIntegrationTest#nombreMetodo`

Configuración de experimentación: `modules/backend/src/test/resources/test-experiment.properties` (start, épocas, población, time-limit, escenarios). Datasets de demo/real: `src/test/resources/datos/...` (referenciados desde `application.properties`).

## Convenciones

- **Idioma**: dominio del algoritmo legado (`dhgs/demo/...`) en **español** (Aeropuerto, Vuelo, Envio, RutaEnvio, etc.). Capa MVC nueva (`backend/...`) en **inglés** (Shipment, Planning). Respetar el idioma del paquete al añadir código.
- **Lombok** activo: `@RequiredArgsConstructor` para inyección por constructor, `@Data`/`@Getter` en modelos. Anotación processor configurado en `pom.xml`.
- **Validación**: DTOs de entrada con `@Valid` + `jakarta.validation` (ver `PlanningController`).
- **Logging**: SLF4J (`LoggerFactory.getLogger`); nivel DEBUG por defecto para `com.tasfb2b.*`.
- **Fechas**: `LocalDateTime` / `LocalDate` (java.time), nunca `Date`.
- **Tests pesados**: marcar con `@Tag("slow-experiment")` para que queden fuera del CI rápido.
- **No usar `mvn` global**: usar siempre el wrapper (`./mvnw` o `mvnw.cmd`).

## Módulos principales y responsabilidad

| Componente | Responsabilidad |
|---|---|
| `OptimizationService` (`dhgs/demo/application`) | Orquesta el flujo: parsea datos → construye `GrafoVuelos` → reparte envíos en épocas vía `SimuladorEpocas` → ejecuta DHGS o IALNS por época → arma `OptimizationResponse`. Punto de entrada del algoritmo. |
| `SimuladorEpocas` | Genera `díasEscenario × 24 / 4` épocas de 4h, libera envíos según `fechaHoraCreacion`, mantiene `AlmacenEstado` por aeropuerto. |
| `GrafoVuelos` | Materializa `Vuelo` (plantilla) → `InstanciaVuelo` (fechado) por día del horizonte. Filtra arcos por capacidad y continuidad temporal. |
| `DHGSAlgorithm` | Genético híbrido: población inicial (greedy/must-go/aleatoria), `OXCrossover`, búsqueda local que cambia membresía (`Add`/`Delete`/`SwapOut`), reparación hacia factibilidad estricta. |
| `IALNSAlgorithm` | Destroy/repair adaptativo con pesos + simulated annealing. Comparte `IALNSContext` (usa `CalculadorFitness` y `Validador` del dominio común). |
| `AlgoritmoSPLIT` | Divide el giant tour en rutas óptimas evaluando cada `Envio` independientemente. **Nota**: por esto los operadores de solo-reordenamiento (`Relocate`, `Swap`, `2Opt`) no afectan fitness con el SPLIT vigente. |
| `CalculadorFitness` | Suma maletas por vuelo, penaliza exceso de almacén (cuadrático), no asignados, lateness. |
| `Validador` | Validación estricta: capacidad por vuelo, deadlines, almacenes, consistencia giant-tour vs asignados. Distinta de `Individuo.validarFactibilidad()` (chequeo interno). |
| `PlanningController` (backend nuevo) | `POST /api/v1/planner/runs` y `GET /api/v1/planner/health`. Aún no integrado con `OptimizationService`. |

## Comandos frecuentes

```bash
# Maven (siempre con wrapper)
./mvnw -pl modules/backend clean install        # build limpio del backend
./mvnw -pl modules/backend spring-boot:run      # arrancar backend
./mvnw -pl modules/backend test                 # tests rápidos
./mvnw -pl modules/backend test -Pwith-experiments    # incluir slow-experiment
./mvnw -pl modules/backend test -Dtest=ClassName#method
./mvnw -pl modules/backend package -DskipTests  # jar sin tests

# Docker (solo servicios de datos)
docker-compose up -d                # postgres + redis + mongo
docker-compose down                 # detener
docker-compose logs -f postgres     # logs de un servicio
docker-compose down -v              # detener y borrar volúmenes (¡destruye datos!)
```

## Notas importantes

- **No tocar `dhgs/demo/...` y `backend/...` como si fueran un solo módulo**: el primero es el motor algorítmico funcional; el segundo es el esqueleto MVC en construcción. Las migraciones entre ellos deben ser explícitas.
- **Movimientos de solo reordenamiento** (Relocate/Swap/2Opt) están desactivados en producción por la lógica de `AlgoritmoSPLIT` actual — ver `ARCHITECTURE.md` § "Papel real de representacionGigante".
- **Fuera de alcance** hoy: cancelaciones de vuelo, replanificación por disrupciones, estados dinámicos por incidente.
