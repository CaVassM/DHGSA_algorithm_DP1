# Plan: Backend Ready for Frontend Handoff

## Contexto
El backend de Tasf.B2B ha completado exitosamente su migración hacia una arquitectura basada en capas con persistencia en PostgreSQL (13 endpoints en 5 controllers, repositorios JPA y mappers implementados). Sin embargo, para que un desarrollador frontend pueda consumir esta API sin fricciones, falta establecer contratos claros de comunicación: la API no está documentada automáticamente, los errores genéricos no tienen un esquema estándar, el endpoint principal de optimización es síncrono (causará timeouts en el navegador) y no hay indicadores de salud reales de la base de datos. Este plan resuelve esas brechas operativas.

## Fases priorizadas

### Fase 1: Swagger/OpenAPI (bloqueante)
- **Objetivo:** Auto-generar la documentación interactiva de la API para que el frontend no tenga que adivinar los contratos de los DTOs.
- **Cambios concretos:**
  - `modules/backend/pom.xml`: Añadir la dependencia `<groupId>org.springdoc</groupId> <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId> <version>2.6.0</version>`.
  - `modules/backend/src/main/resources/application.properties`: Añadir `springdoc.swagger-ui.path=/swagger-ui.html`.
  - En los Controllers (`PlanningController`, `AirportController`, etc.): Añadir `@Tag(name = "X")` en la clase y `@Operation(summary = "Y")` en métodos clave.
- **Comandos de verificación:** 
  - Levantar la app y navegar a `http://localhost:8080/swagger-ui.html` para comprobar que la interfaz renderiza los 13 endpoints.

### Fase 2: CORS productivo (bloqueante)
- **Objetivo:** Reemplazar el comodín inseguro `*` por orígenes explícitos que soporten credenciales/cookies, preparándose para el frontend en Vite.
- **Cambios concretos:**
  - `modules/backend/src/main/java/com/tasfb2b/backend/config/CorsConfig.java`: Modificar `allowedOrigins("*")` a `allowedOrigins("http://localhost:5173", "http://localhost:3000")`.
  - Añadir `.allowCredentials(true)` en la configuración del registry.
- **Comandos de verificación:** 
  - Ejecutar un `curl -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: GET" -v http://localhost:8080/api/v1/airports` y verificar que retorna el header `Access-Control-Allow-Origin`.

### Fase 3: Async planner run (bloqueante)
- **Objetivo:** Evitar timeouts en el frontend haciendo que `POST /api/v1/planner/runs` retorne inmediatamente un `runId` y el estado, dejando la optimización en background.
- **Decisión Arquitectónica:** Se utilizará `@Async` con `ThreadPoolTaskExecutor`. *Justificación:* El proyecto utiliza Spring WebMVC (bloqueante/thread-per-request). Migrar a Project Reactor es overkill para un solo endpoint. Un executor nativo de Spring requiere cero infra adicional comparado con colas como RabbitMQ o Kafka.
- **Cambios concretos:**
  - `modules/backend/src/main/java/com/tasfb2b/backend/config/InfrastructureConfig.java`: Añadir `@EnableAsync` y definir un `@Bean` de `ThreadPoolTaskExecutor` (core size 2, max size 4).
  - `modules/backend/src/main/java/com/tasfb2b/backend/service/PlanningService.java`: 
    - Separar la creación del Run (`createRun`) de la ejecución. 
    - Crear un nuevo método `@Async public void executePlanningAsync(Long runId, PlanningRequest request)`. 
  - `modules/backend/src/main/java/com/tasfb2b/backend/controller/PlanningController.java`: Modificar el POST para devolver `202 Accepted` y el objeto `PlanningRunResponse` (solo id y status `RUNNING`).
  - **Nuevo endpoint:** Añadir `GET /api/v1/planner/runs/{id}` para que el frontend haga polling del status.
- **Comandos de verificación:** 
  - Lanzar el POST, recibir un HTTP 202 en <100ms. Hacer GET al `{id}` repetidamente hasta ver el status `COMPLETED`.

### Fase 4: Contrato de errores (bloqueante)
- **Objetivo:** Estandarizar la estructura JSON de errores para que el frontend pueda parsearlos predeciblemente.
- **Decisión Arquitectónica:** El JSON tendrá el formato: 
  ```json
  {
    "errorCode": "CONFLICT",
    "message": "No hay aeropuertos en la BD. Usa importación primero.",
    "details": ["IllegalStateException: ..."]
  }
  ```
- **Cambios concretos:**
  - `modules/backend/src/main/java/com/tasfb2b/backend/exception/GlobalExceptionHandler.java`:
    - Crear un DTO interno (o record) `ErrorResponse(String errorCode, String message, List<String> details)`.
    - Mapear `IllegalStateException` a `409 CONFLICT` retornando el `ErrorResponse`.
    - Mapear `IllegalArgumentException` a `400 BAD_REQUEST` retornando el `ErrorResponse`.
    - Eliminar los `LinkedHashMap` sueltos y unificar al DTO `ErrorResponse`.
- **Comandos de verificación:** 
  - Hacer un request inválido (ej. POST planner sin importar datos en BD) y verificar que retorna un JSON estructurado con HTTP 409.

### Fase 5: Validaciones + endpoint de status (importante)
- **Objetivo:** Evitar que el frontend mande requests inválidos por falta de tipado estricto y permitir al frontend saber si debe mostrar la pantalla de *Seeding*.
- **Cambios concretos:**
  - `modules/backend/src/main/java/com/tasfb2b/backend/dto/request/PlanningRequest.java`:
    - **ANTES:** `private String dataSetReference;`
    - **DESPUÉS:** Cambiar a un `enum DataSetReference { DEMO, REAL, DB, TEST }`. Anotarlo con `@NotNull`.
  - `modules/backend/src/main/java/com/tasfb2b/backend/controller/AdminImportController.java`:
    - Añadir `GET /status`.
    - Crear `ImportStatusResponse(long airportsCount, long flightsCount, long shipmentsCount)`.
    - Inyectar los repositorios (`AirportRepository`, `FlightRepository`, `ShipmentRepository`) y retornar un `.count()` de cada uno.
- **Comandos de verificación:** 
  - Mandar un POST planner con `dataSetReference: "INVALIDO"` y verificar que rebota por validación.
  - Llamar al `GET /api/v1/admin/imports/status` y recibir los contadores en JSON.

### Fase 6: Actuator (importante)
- **Objetivo:** Monitoreo real del estado de la aplicación y la BD.
- **Cambios concretos:**
  - `modules/backend/pom.xml`: Añadir `<groupId>org.springframework.boot</groupId> <artifactId>spring-boot-starter-actuator</artifactId>`.
  - `modules/backend/src/main/resources/application.properties`: Eliminar el custom health endpoint (si existe config) y exponer `management.endpoints.web.exposure.include=health` y `management.endpoint.health.show-details=always`.
  - `modules/backend/src/main/java/com/tasfb2b/backend/controller/PlanningController.java`: Borrar el método `health()` obsoleto.
- **Comandos de verificación:** 
  - GET `http://localhost:8080/actuator/health` y validar que el nodo `db` muestra `status: UP`.

## Fuera de alcance (con razón)
1. **Migración a Flyway/Liquibase:** Aunque es vital para producción, no es un bloqueante directo para que el desarrollador frontend empiece a desarrollar la UI usando los endpoints actuales (Spring Auto-DDL sirve para el handoff inicial).
2. **Rate Limiting:** Los endpoints de importación son para uso administrativo. Sobrecargar la API con configuración de Buckets ahora retrasa el handoff innecesariamente.
3. **WebSockets para progreso en tiempo real:** Hacer polling al `GET /api/v1/planner/runs/{id}` es más robusto y rápido de implementar en un MVP comparado con configurar una capa STOMP/WebSocket completa.

## Verificación end-to-end del handoff
1. El backend levanta sin errores de compilación ni fallos en tests.
2. La documentación interactiva de la API vive en `/swagger-ui.html`.
3. Un cliente externo (Frontend Vite corriendo en el puerto `5173`) puede realizar peticiones a la API exitosamente gracias a la configuración de CORS explícita.
4. El inicio de la simulación responde en menos de 100ms con HTTP 202 (Asíncrono).
5. Todos los errores retornan el JSON estructurado unificado (`errorCode`, `message`, `details`).
