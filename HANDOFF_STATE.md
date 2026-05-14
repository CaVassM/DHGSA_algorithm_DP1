# Tasf.B2B — Estado del proyecto y guía de continuación

> **Léeme antes de seguir trabajando.** Este documento es el punto único de verdad para retomar el proyecto si cambia el ejecutor, pasa tiempo, o se acaban créditos de una sesión. Última actualización: **2026-05-14**.

---

## 1. ¿Qué es Tasf.B2B?

Sistema de planificación de equipajes extraviados entre aeropuertos. Dos metaheurísticas (**DHGS** genético híbrido, **IALNS** ALNS + simulated annealing) que comparten dominio, simulación temporal por épocas y validador. Cada época cubre 4h y se optimiza independientemente sobre una "foto" del sistema.

**Stack**: Java 21, Spring Boot 3.3.5, Maven multimódulo, PostgreSQL 15 (vía docker-compose), JPA, Lombok. Frontend en `modules/frontend/` está **vacío** y lo construye otra persona.

**Documentación de negocio**: `CLAUDE.md` (convenciones), `ARCHITECTURE.md`, `docs/PLANIFICADOR_EXPLICADO_SIMPLE.md`, `docs/CONTEXTO_DATOS.md`.

---

## 2. Estado actual

### ✅ Hecho

#### Migración del backend (BACKEND_ROADMAP original — auditado y ejecutado)
- **Persistencia PostgreSQL**: 6 entidades JPA en `modules/backend/src/main/java/com/tasfb2b/backend/domain/model/`:
  `AirportEntity`, `FlightEntity`, `ShipmentEntity` (refactorizado desde el UUID minimal anterior), `RouteEntity`, `RouteLegEntity`, `PlanningRunEntity`. Tablas: `aeropuertos`, `vuelos`, `envios`, `rutas`, `ruta_legs`, `planning_runs`.
- **5 repositorios Spring Data JPA** en `repository/`: `Airport`, `Flight`, `Shipment` (reemplazó al bareback interface anterior), `PlanningRun`, `Route` (con JPQL fetch-joined para legs).
- **Mapper Domain↔Entity** en `mapper/DomainMapper.java`.
- **OptimizationService refactorizado** ([modules/backend/.../OptimizationService.java](modules/backend/src/main/java/com/tasfb2b/dhgs/demo/application/service/OptimizationService.java)): añadido `ejecutarSobreDatos(...)` que acepta objetos pre-cargados sin parsers; método compartido `procesar(...)`. Nuevo DTO `OptimizationOutcome` con el `Map<String, RutaEnvio>` para persistir.
- **PlanningService refactorizado** con rama `dataSetReference=db` y persistencia transaccional de `PlanningRun + Route + RouteLeg`.
- **13 endpoints REST** (ver sección 7).
- **Admin import** que reusa los 3 parsers existentes (`AeropuertoParser`, `VueloParser`, `EnvioParser`) — no se reescribieron.
- **CRUD DTOs** (records) en `dto/response/` — no se exponen entidades directamente.
- **Configuración**: `pom.xml` con `spring-data-jpa`, `postgresql`, `h2` (test), `springdoc-openapi`. `application.properties` con datasource Postgres + Hikari + `open-in-view=false`. `application-test.properties` con H2 in-memory.
- **Tests**: `@DataJpaTest` para `AirportRepository`, `@WebMvcTest` para `AirportController`, `contextLoads` con H2. **4/4 verdes**. `IngestionDatosRealesTest` falla con 5 errores pero es **deuda preexistente** (faltan archivos `datos/estudiantes_real.txt` y `datos/envios_preliminar/` en `src/test/resources/datos/`), NO regresiones.

#### Handoff plan (Fase 1 ejecutada)
- **Swagger / OpenAPI** activo. Dependencia `springdoc-openapi-starter-webmvc-ui:2.6.0`. Los 5 controllers tienen `@Tag` + `@Operation` mínimas. UI en `/swagger-ui.html`, spec en `/v3/api-docs`.

### ⏳ Pendiente

Las fases siguientes vienen del `Roadmap/HANDOFF_PLAN.md` (escrito por Gemini, auditado por Claude). **Ya hay correcciones detectadas que NO están en el plan de Gemini** — ver sección 3.

#### Resumen

| # | Fase | Estado | Bloqueante | Costo |
|---|---|---|---|---|
| 2 | CORS productivo | ✅ HECHA | Sí (sin esto el frontend no llama) | Bajo |
| 4 | Contrato de errores unificado | ✅ HECHA | No | Bajo |
| 6 | Spring Boot Actuator | ✅ HECHA | No | Bajo |
| 5 | Enum `DataSetReference` + status endpoint | ✅ HECHA | No | Medio |
| 3 | Async planner run | ✅ HECHA | **Sí si datos grandes** | Alto |

**Orden recomendado**: 2 → 4 → 6 → 5 → 3 (baratas primero, async más invasiva al final). El frontend dev puede empezar a integrar tras la Fase 2.

**Cómo usar los sub-pasos**: cada sub-paso es atómico y verificable. Si una fase queda a medias, el siguiente ejecutor marca los `[x]` completados y arranca en el primer `[ ]` que queda. Compilar después de cada sub-paso significativo. Cuando una fase termina, cambiar el estado en la tabla resumen y marcar todos los sub-pasos `[x]`.

---

#### Fase 2 — CORS productivo (estado: NO INICIADA)

**Objetivo**: reemplazar `allowedOrigins("*")` por orígenes explícitos del frontend, habilitar credenciales para soportar cookies/Authorization headers.

Sub-pasos:
- [ ] 2.1 Editar `modules/backend/src/main/java/com/tasfb2b/backend/config/CorsConfig.java`:
  - Cambiar `.allowedOrigins("*")` a `.allowedOrigins("http://localhost:5173", "http://localhost:3000")`.
  - Añadir `.allowCredentials(true)`.
  - Añadir `.allowedHeaders("*")` (necesario cuando `allowCredentials=true`, ya que `*` ya no funciona implícitamente).
  - Añadir `.exposedHeaders("Location")` (útil si en el futuro el async devuelve `Location`).
- [ ] 2.2 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 2.3 Verificación manual (opcional, requiere backend corriendo):
  ```powershell
  curl.exe -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET" `
    -X OPTIONS -v http://localhost:8080/api/v1/airports 2>&1 | findstr "Access-Control"
  # Debe imprimir: Access-Control-Allow-Origin: http://localhost:5173
  #                Access-Control-Allow-Credentials: true
  ```

---

#### Fase 4 — Contrato de errores unificado (estado: NO INICIADA)

**Objetivo**: que todos los errores devueltos por el backend tengan el mismo shape JSON (`errorCode`, `message`, `details?`) para que el frontend pueda parsearlos predeciblemente.

Sub-pasos:
- [ ] 4.1 Crear `modules/backend/src/main/java/com/tasfb2b/backend/exception/ErrorResponse.java`:
  ```java
  public record ErrorResponse(String errorCode, String message, List<String> details) {
      public static ErrorResponse of(String errorCode, String message) {
          return new ErrorResponse(errorCode, message, List.of());
      }
  }
  ```
- [ ] 4.2 Reescribir `GlobalExceptionHandler.java` para usar `ErrorResponse` en todos los handlers existentes + añadir 2 nuevos:
  - `ResourceNotFoundException` → 404 con `errorCode = "RESOURCE_NOT_FOUND"`.
  - `MethodArgumentNotValidException` → 400 con `errorCode = "VALIDATION_ERROR"` + `details` poblado con `field: message`.
  - **NUEVO** `IllegalStateException` → 409 CONFLICT con `errorCode = "CONFLICT"` (cubre el caso "no hay aeropuertos en BD").
  - **NUEVO** `IllegalArgumentException` → 400 BAD_REQUEST con `errorCode = "BAD_REQUEST"` (cubre dataset no reconocido).
  - `Exception` genérico → 500 con `errorCode = "INTERNAL_ERROR"` + `details` con el message original.
- [ ] 4.3 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 4.4 Verificación manual (opcional):
  ```powershell
  # Disparar el caso "no hay aeropuertos" (sin imports previos): debe devolver 409 + ErrorResponse JSON.
  curl.exe -X POST http://localhost:8080/api/v1/planner/runs -H "Content-Type: application/json" `
    -d '{\"algorithm\":\"DHGS\",\"scenario\":\"PERIOD_SIMULATION\",\"planningStart\":\"2026-01-02T00:00:00\",\"dataSetReference\":\"db\"}'
  ```

---

#### Fase 6 — Spring Boot Actuator (estado: NO INICIADA)

**Objetivo**: reemplazar el `/planner/health` custom por `/actuator/health` que reporta DB status real.

Sub-pasos:
- [ ] 6.1 Añadir en `pom.xml` (después de springdoc-openapi):
  ```xml
  <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
  </dependency>
  ```
- [ ] 6.2 Añadir en `application.properties`:
  ```properties
  management.endpoints.web.exposure.include=health,info
  management.endpoint.health.show-details=always
  management.endpoint.health.probes.enabled=true
  ```
- [ ] 6.3 Borrar el método `health()` y los imports `Map`, `Map.of(...)` no usados en `PlanningController.java` (ya no será necesario el endpoint custom).
- [ ] 6.4 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 6.5 Verificación manual: `GET http://localhost:8080/actuator/health` → debe responder `{"status":"UP","components":{"db":{"status":"UP",...}}}`.

---

#### Fase 5 — Enum `DataSetReference` + endpoint `/admin/imports/status` (estado: NO INICIADA)

**Objetivo (a)**: tipar fuerte el `dataSetReference` para rechazar valores inválidos automáticamente.
**Objetivo (b)**: que el frontend pueda preguntar "¿ya hay datos cargados?" antes de mostrar la pantalla de import.

Sub-pasos (objetivo a):
- [ ] 5.1 Crear `modules/backend/src/main/java/com/tasfb2b/backend/domain/enums/DataSetReference.java`:
  ```java
  public enum DataSetReference { DEMO, TEST, REAL, DB }
  ```
- [ ] 5.2 Editar `dto/request/PlanningRequest.java`:
  - Cambiar `private String dataSetReference;` → `private DataSetReference dataSetReference;`.
  - Decidir si es `@NotNull` o si null se trata como default (el código actual usa default según scenario; mantener ese comportamiento es lo menos disruptivo).
- [ ] 5.3 **Refactor en cascada** en `service/PlanningService.java`:
  - `resolveReference(PlanningRequest)`: ya no hace `toLowerCase` ni trim; ahora devuelve `DataSetReference` (no String). Si es null, decide entre `DEMO` o `REAL` según scenario.
  - Cambiar la firma del helper `resolveFileDataset(String)` → `resolveFileDataset(DataSetReference)` y reemplazar el switch sobre strings por switch sobre enum.
  - `schedulePlanning`: la condición `"db".equals(reference)` se vuelve `reference == DataSetReference.DB`.
  - `createRun`: el `dataSetReference` que se guarda en `PlanningRunEntity` cambia de String a `reference.name()` (porque la entidad lo guarda como String).
- [ ] 5.4 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 5.5 Verificación: enviar `POST /planner/runs` con `"dataSetReference":"INVALIDO"` debe devolver 400 (Jackson rechaza el enum) con `ErrorResponse` (asumiendo Fase 4 hecha) o el handler de Spring de deserialización.

Sub-pasos (objetivo b):
- [ ] 5.6 Crear `modules/backend/src/main/java/com/tasfb2b/backend/dto/response/ImportStatusResponse.java`:
  ```java
  public record ImportStatusResponse(long airportsCount, long flightsCount, long shipmentsCount) {}
  ```
- [ ] 5.7 Añadir método en `service/AdminImportService.java`:
  ```java
  public ImportStatusResponse status() {
      return new ImportStatusResponse(
          airportRepository.count(), flightRepository.count(), shipmentRepository.count());
  }
  ```
- [ ] 5.8 Añadir endpoint en `controller/AdminImportController.java`:
  ```java
  @GetMapping("/status")
  @Operation(summary = "Contadores de datos cargados (para que el frontend decida si saltar la pantalla de import)")
  public ResponseEntity<ImportStatusResponse> status() {
      return ResponseEntity.ok(adminImportService.status());
  }
  ```
- [ ] 5.9 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 5.10 Verificación: `GET /api/v1/admin/imports/status` devuelve los 3 contadores.

---

#### Fase 3 — Async planner run (estado: NO INICIADA)

**Objetivo**: `POST /planner/runs` debe devolver `202 Accepted` con `runId` y `status=RUNNING` en < 200ms; la optimización corre en background; el frontend hace polling a `GET /planner/runs/{id}` hasta ver `status=COMPLETED` o `FAILED`.

**CRÍTICO — trampas técnicas** (ver también sección 3):
- `@Async` self-invocation: si `schedulePlanning` (en `PlanningService`) llama a un método `@Async` de la **misma clase**, Spring NO intercepta → corre síncrono. **Solución**: el método async vive en otra clase (`PlanningRunExecutor`).
- Transaccionalidad: la transacción de `schedulePlanning` se cierra antes de que el thread async corra. El método async **necesita su propio `@Transactional`**.
- Excepciones en `@Async void` se pierden. Envolver en try/catch que actualice `status=FAILED`.

Sub-pasos:
- [ ] 3.1 Crear `modules/backend/src/main/java/com/tasfb2b/backend/config/AsyncConfig.java`:
  ```java
  @Configuration
  @EnableAsync
  public class AsyncConfig {
      @Bean(name = "planningExecutor")
      public ThreadPoolTaskExecutor planningExecutor() {
          ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
          executor.setCorePoolSize(2);
          executor.setMaxPoolSize(4);
          executor.setQueueCapacity(50);
          executor.setThreadNamePrefix("planning-");
          executor.initialize();
          return executor;
      }
  }
  ```
- [ ] 3.2 Crear `modules/backend/src/main/java/com/tasfb2b/backend/service/PlanningRunExecutor.java` con un único método `@Async("planningExecutor")`:
  ```java
  @Service
  @RequiredArgsConstructor
  public class PlanningRunExecutor {
      private static final Logger log = LoggerFactory.getLogger(PlanningRunExecutor.class);
      // inyectar mismos repos/services que necesita: PlanningRunRepository, RouteRepository,
      // AirportRepository, FlightRepository, ShipmentRepository, OptimizationService

      @Async("planningExecutor")
      @Transactional
      public void executeRun(Long runId, PlanningRequest request, PlannerAlgorithm algorithm,
                             DataSetReference reference) {
          try {
              // 1. recargar run de BD (estamos en thread distinto, no podemos usar referencias del caller)
              // 2. Ejecutar optimización según reference (db o files), igual que hoy PlanningService.runWith*
              // 3. persistOutcome (idéntico al actual): update run + crear RouteEntity + RouteLegEntity
          } catch (Exception ex) {
              log.error("Error en async run {}", runId, ex);
              planningRunRepository.findById(runId).ifPresent(run -> {
                  run.setStatus(PlanningRunStatus.FAILED);
                  run.setFinishedAt(LocalDateTime.now());
                  run.setMensaje("Error: " + ex.getMessage());
                  planningRunRepository.save(run);
              });
          }
      }
  }
  ```
- [ ] 3.3 Mover la lógica de `runWithFiles`, `runWithDatabase` y `persistOutcome` desde `PlanningService` a `PlanningRunExecutor`. Mantener todo el contenido idéntico — solo cambia de clase.
- [ ] 3.4 Refactor `PlanningService.schedulePlanning`:
  - Crea el `PlanningRunEntity` con `status=RUNNING` (igual que hoy `createRun`).
  - Llama a `planningRunExecutor.executeRun(run.getId(), request, algorithm, reference)` (no espera el resultado).
  - Devuelve `PlanningResponse` con `runId` + `status="RUNNING"` + el resto de campos vacíos/cero.
- [ ] 3.5 Adaptar `PlanningResponse.fromOptimizationResult` o crear un nuevo factory `forAcceptedRun(Long runId, PlannerAlgorithm, OperationalScenario, String dataSetReference)` que devuelva el objeto minimal sin tocar el `OptimizationResponse` (porque aún no existe).
- [ ] 3.6 `PlanningController.createPlanningRun`: ya devuelve `ResponseEntity.accepted()` (202) — solo cambia el body al nuevo response minimal.
- [ ] 3.7 `./mvnw.cmd -pl modules/backend compile` → BUILD SUCCESS.
- [ ] 3.8 Verificación end-to-end manual:
  ```powershell
  # POST debe responder en < 200ms con status=RUNNING
  curl.exe -X POST http://localhost:8080/api/v1/planner/runs -H "Content-Type: application/json" `
    -d '{...}' -w "%{time_total}\n"
  # Anota el runId. Polling cada 2s hasta ver status=COMPLETED:
  curl.exe http://localhost:8080/api/v1/planner/runs/1
  ```
- [ ] 3.9 Verificar caso FAILED: lanzar un run con `dataSetReference=db` sin importar datos primero. Debe terminar con `status=FAILED` y un mensaje claro, NO quedarse en RUNNING para siempre.

---

## 3. Correcciones críticas al HANDOFF_PLAN.md (importantes si lo ejecutas)

Gemini escribió un plan razonable pero **siguió cometiendo el patrón de "planificar sin leer el código"**. Errores detectados que debes corregir al ejecutar:

1. **Fase 3 dice "añadir `GET /api/v1/planner/runs/{id}` para polling"**. Ese endpoint **ya existe** en [PlanningController.java](modules/backend/src/main/java/com/tasfb2b/backend/controller/PlanningController.java#L42). NO lo crees de nuevo. Solo úsalo para polling.

2. **Fase 3 NO menciona el problema de `@Async` self-invocation**. Si pones `executePlanningAsync` en `PlanningService` y llamas a él desde `schedulePlanning` (misma clase), Spring AOP NO intercepta el `@Async` por el proxy CGLIB → corre síncrono. **Solución**: mover `executePlanningAsync` a una clase nueva (sugerido: `PlanningRunExecutor`) que se inyecte en `PlanningService`.

3. **Fase 3 omite que el método async necesita `@Transactional` propio**. El `persistOutcome` actual está bajo la transacción de `schedulePlanning`. Al pasarlo a async, esa transacción se cierra antes de que el thread async termine → las escrituras posteriores quedan sin contexto transaccional.

4. **Fase 3 omite el manejo de excepciones async**. Excepciones en `@Async void` se pierden silenciosamente. Envolver el cuerpo en try/catch que actualice `run.setStatus(FAILED)` y `run.setMensaje(ex.getMessage())`.

5. **Fase 5 omite el refactor en cascada del enum**. Cambiar `private String dataSetReference;` a enum requiere modificar `resolveReference()` (que hace `toLowerCase()`), `resolveFileDataset()` (switch sobre strings), y el `if ("db".equals(reference))` en `schedulePlanning()`. No es un cambio de una línea como sugiere el plan.

6. **Fase 1 minor (ya corregido)**: NO añadir `springdoc.swagger-ui.path=/swagger-ui.html` — esa es la ruta default, agregarla solo suma ruido.

---

## 4. Cómo retomar (nueva sesión, cero contexto)

### Paso 1: leer en este orden
1. Este documento entero.
2. `CLAUDE.md` (raíz) — convenciones del proyecto.
3. `C:\Users\HP\.claude\plans\roadmap-backend-roadmap-md-puedes-audita-rosy-newt.md` — audit del roadmap inicial.
4. `Roadmap/HANDOFF_PLAN.md` — plan de Gemini con las correcciones de la sección 3 aplicadas.
5. Estado actual del git: `git status && git log --oneline -10`.

### Paso 2: verificar que todo sigue compilando
```powershell
./mvnw.cmd -pl modules/backend compile
# Esperado: BUILD SUCCESS
```

### Paso 3: verificar Swagger / endpoints existentes (opcional pero recomendado)
Sección 6 ("Cómo probar end-to-end").

### Paso 4: continuar con la siguiente fase pendiente
Mirar la tabla de la sección 2. Empezar por la primera no marcada como hecha. **Antes de planificar el cambio, leer los archivos involucrados** — esa es la lección principal de este proyecto.

---

## 5. Para el planificador (Gemini Pro) — qué hacer y qué evitar

### Lecciones de las planificaciones previas

Gemini ha hecho dos planes en este proyecto y ambos tuvieron el **mismo defecto raíz**: planificar sin leer el código. Errores concretos cometidos:

- **Propuso crear `ShipmentEntity`** sin saber que ya existía (con UUID, en inglés, minimal).
- **Propuso `EnvioRepository extends JpaRepository`** sin saber que ya había un `ShipmentRepository` que NO extendía JPA (era interface a mano).
- **Propuso atributos faltantes** para `Vuelo` (sin `capacidadDisponible`), `Envio` (sin `esMustGo`, `prioridad`), `Route` (sin `secuenciaVuelos`, que es el corazón de una ruta).
- **Mismo error otra vez**: en el HANDOFF_PLAN propuso "crear `GET /runs/{id}`" cuando ese endpoint ya existía.
- **Contradicciones internas no resueltas**: Fase 2 del primer plan decía "español", "Instrucciones operativas" del mismo plan decían "inglés".
- **Saltos lógicos sin verificar prerequisitos**: "inyectar `repository.findAll()` antes de la sim" sin notar que `OptimizationService` solo aceptaba paths de archivo y necesitaba refactor previo.
- **Refactors en cascada no documentados**: cambiar un `String` a enum sin notar que rompía un switch en otro archivo.
- **Trampas técnicas conocidas no advertidas**: no mencionar el problema de `@Async` self-invocation en Spring.

### Checklist para Gemini antes de entregar un plan

- [ ] **Leí los archivos que voy a modificar**, no asumí su contenido.
- [ ] **Hice grep por los nombres de clase/método/endpoint** que propongo crear, para verificar que no existen ya.
- [ ] **Copié las firmas reales** (tipos, anotaciones, atributos) — no las reinventé.
- [ ] **Las decisiones en el plan son consistentes**: si decidí inglés en una sección, todas las secciones dicen inglés.
- [ ] **Cada paso que requiera refactor previo lo dice explícitamente** como subpaso, no asume que es fácil.
- [ ] **Para cada cambio respondí 4 preguntas**: (a) cómo entran los datos, (b) cómo se agrupan los resultados, (c) cómo se mapea, (d) cómo se prueba.
- [ ] **Listé las trampas técnicas conocidas** del stack (`@Async` self-invocation, `@Transactional` en proxies, `open-in-view`, `EAGER` fetch, etc.) que aplican.
- [ ] **El detalle es proporcional al riesgo**: no detallé cada anotación Lombok si lo arriesgado está en una línea de refactor.
- [ ] **Tests**: cada fase dice cómo verificar que funcionó (curl, MockMvc, `@DataJpaTest`, etc.).
- [ ] **Ambigüedades resueltas**: si tenía dudas, las decidí en el plan y justifiqué — no las dejé flotando para que las resuelva el ejecutor.

### Cómo escribir un brief para Gemini

Cuando le pidas a Gemini la siguiente fase:
1. **Dale contexto rápido** del proyecto (1 párrafo) y del objetivo de ESTA fase (1-2 oraciones).
2. **Dale la lista exacta de archivos a leer** antes de planificar (paths absolutos del repo).
3. **Identifica las brechas concretas** que ya detectaste — no le pidas "encuentra qué falta".
4. **Pídele que tome decisiones**, no que te las pregunte de vuelta.
5. **Adjunta las lecciones previas** (la lista de errores arriba) para que no los repita.
6. **Define el formato exacto del entregable** (estructura del markdown).

Ejemplo de brief bien construido en el chat del 2026-05-14, sección "Brief para Gemini".

---

## 6. Para el ejecutor (Claude / nueva sesión)

### Archivos sensibles — leer antes de modificar

| Archivo | Estado | Cuidado |
|---|---|---|
| `dhgs/demo/domain/model/*.java` | Funcionando | **NO tocar** las clases `Aeropuerto`, `Vuelo`, `Envio`, `RutaEnvio`. Son el dominio del algoritmo. Sus atributos están en español y deben quedarse así. |
| `dhgs/demo/application/service/OptimizationService.java` | Refactorizado | Ya tiene `ejecutar` (file-based) y `ejecutarSobreDatos` (data-based). Usa `procesar(...)` privado compartido. NO romper la firma de `ejecutar(OptimizationRequest)`. |
| `dhgs/demo/algorithm/`, `infraestructure/` | Funcionando | El núcleo del algoritmo. **NO refactorizar** salvo solicitud explícita. |
| `backend/domain/model/ShipmentEntity.java` | Refactorizado | Antes tenía UUID + 4 campos. Ahora `Long` id + business_id + 8 campos que mapean `Envio`. NO volver al estado anterior. |
| `backend/repository/ShipmentRepository.java` | Reemplazado | Antes era interface sin extender nada. Ahora extiende `JpaRepository<ShipmentEntity, Long>`. |
| `backend/service/PlanningService.java` | Refactorizado | Tiene rama `dataSetReference=db` + persistencia transaccional de runs. Si haces async, separa el método async a otra clase. |

### Convenciones (de `CLAUDE.md`)

- **Idioma**: `backend/...` en inglés, `dhgs/demo/...` en español. Respetar al añadir código.
- **Lombok**: activo. Usar `@RequiredArgsConstructor` para DI, `@Getter/@Setter`, `@Builder` cuando hay > 4 atributos.
- **Fechas**: `LocalDateTime` / `LocalDate` / `LocalTime` (java.time). Nunca `Date`.
- **Logging**: SLF4J. Nivel DEBUG para `com.tasfb2b.*`.
- **Wrapper Maven**: siempre `./mvnw` o `mvnw.cmd`. NO `mvn` global.
- **Validación**: `@Valid` + `jakarta.validation` en request DTOs.
- **Tests pesados**: marcar con `@Tag("slow-experiment")`. Excluidos por defecto vía `surefire.excludedGroups`.

### Antipatrones detectados en el repo (no introducir más)

- **No exponer entidades JPA en controllers**. Usar DTOs (`*Response` records).
- **No usar `String` para enumerados conocidos**. Usar `enum` (excepción actual: `dataSetReference` — está en la fase 5).
- **No llamar a métodos `@Async` o `@Transactional` desde la misma clase** (self-invocation rompe proxy).
- **No usar `open-in-view=true`** (ya está en false; no cambiar).

### Antes de cada cambio, verifica

1. ¿El nombre que voy a crear ya existe? → `Grep` por el nombre.
2. ¿El refactor que estoy haciendo rompe algún caller? → `Grep` por la firma actual.
3. ¿Tengo todos los imports? → IDE diagnostics o `compile`.
4. ¿Compila? → `./mvnw.cmd -pl modules/backend compile` antes de marcar la fase como hecha.

---

## 7. Endpoints REST actuales

Todos bajo `http://localhost:8080/api/v1/`.

### Admin Imports
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/admin/imports/airports` | Multipart `file=@estudiantes.txt`. Upsert por ICAO. |
| POST | `/admin/imports/flights` | Multipart `file=@planes_vuelo.txt`. Requiere airports previos. Upsert por businessId. |
| POST | `/admin/imports/shipments` | Multipart `files[]=...`. Origen inferido del nombre del archivo. |

### Catálogos (lectura, paginado)
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/airports` | Lista paginada. |
| GET | `/airports/{id}` | Por PK. |
| GET | `/airports/icao/{icao}` | Por código ICAO. |
| GET | `/flights` | Lista paginada. |
| GET | `/flights/{id}` | Por PK. |
| GET | `/shipments` | Lista paginada. |
| GET | `/shipments/{id}` | Por PK. |

### Planning
| Método | Ruta | Descripción |
|---|---|---|
| POST | `/planner/runs` | Body: `PlanningRequest`. Hoy síncrono — futuro async (Fase 3). Devuelve `PlanningResponse` con `runId`. |
| GET | `/planner/runs` | Lista paginada de runs. |
| GET | `/planner/runs/{id}` | Detalle de un run. |
| GET | `/planner/runs/{id}/routes` | Rutas asignadas en un run. |
| GET | `/planner/health` | (será reemplazado por Actuator en Fase 6). |

### Documentación interactiva
- `/swagger-ui.html` — UI de Swagger con todos los endpoints.
- `/v3/api-docs` — spec OpenAPI 3 JSON.

---

## 8. Cómo probar end-to-end

### Pre-requisitos
- Docker Desktop arrancado (icono en barra de tareas, no rojo).

### Comandos

```powershell
# 1. Postgres
docker compose up -d postgres
docker exec dhgsa_algorithm_dp1-postgres-1 pg_isready -U tasf

# 2. Backend (deja la terminal viva)
./mvnw.cmd -pl modules/backend spring-boot:run

# 3. Cuando veas "Started TasfB2BBackendApplication in X seconds":
#    abrir http://localhost:8080/swagger-ui.html
```

### Flujo de prueba en Swagger UI

1. **Admin Imports → POST `/admin/imports/airports`** → "Try it out" → seleccionar `modules/backend/src/test/resources/datos/estudiantes.txt` → Execute.
2. **POST `/admin/imports/flights`** → `planes_vuelo.txt`.
3. **POST `/admin/imports/shipments`** → los 3 archivos `envios_*.txt` de `envios_preliminar_test/`.
4. **GET `/airports`** → verificar que aparecen 7 aeropuertos.
5. **Planning → POST `/planner/runs`** con body:
   ```json
   {
     "algorithm": "DHGS",
     "scenario": "PERIOD_SIMULATION",
     "planningStart": "2026-01-02T00:00:00",
     "dataSetReference": "db",
     "horizonDays": 1,
     "populationSize": 6,
     "timeLimitSeconds": 2
   }
   ```
   Anota el `runId`.
6. **GET `/planner/runs/{runId}/routes`** → ver las rutas calculadas con `flightBusinessIds[]` ordenados.

Si los 6 pasos pasan, **el backend está funcionando completo end-to-end**.

### Verificar tablas creadas en Postgres

```powershell
docker exec -it dhgsa_algorithm_dp1-postgres-1 psql -U tasf -d tasf_b2b -c "\dt"
# Esperado: aeropuertos, vuelos, envios, rutas, ruta_legs, planning_runs
```

### Correr tests

```powershell
# Rápidos (sin datasets reales)
./mvnw.cmd -pl modules/backend test

# Pesados (requiere archivos *_real.txt que NO están en el repo todavía)
./mvnw.cmd -pl modules/backend test -Pwith-experiments
```

---

## 9. Decisiones tomadas (registro para evitar redebates)

| Decisión | Razón |
|---|---|
| Entidades JPA en inglés (`AirportEntity`, etc.) | CLAUDE.md dicta: capa `backend/` en inglés. Tablas en español (`aeropuertos`) para mapear 1:1 con dominio. |
| Surrogate `Long id` + business `String businessId` con unique index | Preservar IDs semánticos del dominio (`VL-SKBO-SEQM-1`) sin perder PK numérica. |
| `PlanningRunEntity` agrupador de rutas | Trazabilidad: qué rutas vinieron de qué algoritmo/escenario/cuándo. |
| `InstanciaVuelo` y `AlmacenEstado` NO se persisten | Son estado runtime reconstruido por época. |
| DTOs de respuesta como records, no entidades expuestas | Evitar leaks de lazy proxies y serialización rota. |
| Admin import reusa parsers existentes (no reescribir) | Cero deuda nueva. Los parsers ya manejan los formatos exóticos (DMS coords, BOM detection). |
| Mapper Domain↔Entity manual (no MapStruct) | Cantidad de campos chica, evitar dependency adicional. |
| H2 in-memory para tests, Postgres para dev/prod | Tests rápidos sin docker. |
| `ddl-auto=update` (NO Flyway aún) | Aceptable para spike. TODO en `application.properties` para migrar a Flyway antes de datos productivos. |

---

## 10. Comandos rápidos

```powershell
# Compilar
./mvnw.cmd -pl modules/backend compile

# Tests rápidos
./mvnw.cmd -pl modules/backend test

# Test específico
./mvnw.cmd -pl modules/backend test -Dtest=AirportRepositoryTest

# Arrancar backend
./mvnw.cmd -pl modules/backend spring-boot:run

# Postgres up/down
docker compose up -d postgres
docker compose stop postgres

# Ver tablas
docker exec -it dhgsa_algorithm_dp1-postgres-1 psql -U tasf -d tasf_b2b -c "\dt"

# Estado git
git status
git log --oneline -10
```

---

## 11. Archivos clave del repo (referencia rápida)

```
modules/backend/
├── pom.xml                                          # dependencias maven
├── src/main/resources/application.properties        # datasource + props
├── src/test/resources/application-test.properties   # H2 in-memory
├── src/main/java/com/tasfb2b/
│   ├── backend/                                     # capa MVC nueva (inglés)
│   │   ├── controller/                              # 5 controllers
│   │   ├── service/                                 # AirportService, FlightService, ShipmentService, PlanningService, PlanningRunService, AdminImportService
│   │   ├── repository/                              # 5 JPA repos
│   │   ├── domain/model/                            # 6 entidades JPA
│   │   ├── domain/enums/                            # PlannerAlgorithm, OperationalScenario, PlanningRunStatus
│   │   ├── dto/request/                             # PlanningRequest
│   │   ├── dto/response/                            # 6 response records
│   │   ├── mapper/DomainMapper.java                 # Entity ↔ Domain
│   │   ├── exception/                               # GlobalExceptionHandler + ResourceNotFoundException
│   │   └── config/                                  # Cors, WebSocket, Infrastructure
│   └── dhgs/demo/                                   # algoritmo legado (español, NO tocar salvo OptimizationService)
│       ├── application/service/OptimizationService.java
│       ├── application/dto/                         # OptimizationRequest/Response/Outcome
│       ├── domain/model/                            # Aeropuerto, Vuelo, Envio, RutaEnvio, etc.
│       ├── algorithm/dhgs/                          # DHGS
│       ├── algorithm/ialns/                         # IALNS
│       └── infraestructure/ingestion/               # 3 parsers
docker-compose.yml                                   # postgres + redis + mongo
CLAUDE.md                                            # convenciones
Roadmap/
├── BACKEND_ROADMAP.md                               # primer plan (auditado y ejecutado)
└── HANDOFF_PLAN.md                                  # plan actual (Fase 1 ejecutada; 2-6 pendientes)
HANDOFF_STATE.md                                     # ESTE ARCHIVO
```

---

**Fin del documento.** Cuando termines una fase, actualiza la tabla de la sección 2 y la sección 9 si tomaste decisiones nuevas.
