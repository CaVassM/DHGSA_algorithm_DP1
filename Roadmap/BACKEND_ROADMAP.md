# Roadmap para Construcción del Backend (Persistencia y API REST)

Este roadmap es una guía estricta diseñada para ser ejecutada por **Claude Code** para migrar la capa de persistencia (de `.txt` a PostgreSQL) de Tasf.B2B. 

El proyecto ya cuenta con el algoritmo optimizador funcional en memoria, y **ya existen** algunas entidades base en `com.tasfb2b.backend.domain.model`. Antes de proponer crear cualquier clase nueva, **DEBES hacer un grep/búsqueda** para verificar si ya existe (ej. `ShipmentEntity`, `FlightEntity`, `AirportEntity`).

---

## FASE 1: Configuración de Ingesta y Base de Datos
**¿Cómo entran los datos?** Actualmente leen de `.txt`. Debemos configurar la BD y crear un mecanismo inicial para poblarla.

1. **Configurar `application.properties`**
   - Asegurar conexión a PostgreSQL (`tasf_b2b` con user `tasf`).
   - Usar `spring.jpa.hibernate.ddl-auto=update` (Nota: esto es provisional para dev; a futuro se debe planificar la migración a Flyway/Liquibase).
2. **Estrategia de Ingesta (Data Seeding)**
   - Implementar un servicio de *seed* (ej. `DataSeederService`) que lea los archivos `.txt` actuales de `src/test/resources/datos/` y los inserte en PostgreSQL utilizando los nuevos repositorios si la BD está vacía.

---

## FASE 2: Completar Mapeo Objeto-Relacional (Entidades JPA)
**Objetivo:** Consolidar las entidades JPA existentes para que mapeen al 100% los atributos requeridos por el algoritmo, preservando la separación entre PKs y Business IDs.

1. **Refactorizar `AirportEntity`, `FlightEntity` y `ShipmentEntity`**
   - Ya existen. Validar que preserven los IDs de negocio (ej. `id_negocio`, `business_id`) separados de sus Surrogate Keys (`Long id`).
   - Asegurarse de que `FlightEntity` mapee correctamente tipos complejos (ej. `java.time.Duration` del dominio a `Long duracionMinutos` en BD).
2. **Crear `RutaEnvioEntity` (Si no existe)**
   - Representa la ruta final asignada. 
   - Debe tener un surrogate `Long id`, una relación `@OneToOne` o `@ManyToOne` con `ShipmentEntity`.
   - **Crucial:** Debe incluir la `secuenciaVuelos`. Definir explícitamente cómo se mapea la lista de vuelos (e.g., `@ManyToMany` con `FlightEntity` o una tabla intermedia `ruta_vuelos` para mantener el orden de las escalas).
3. **Agrupación de Resultados (Nueva Entidad: `PlanningRunEntity`)**
   - **¿Cómo se agrupan los resultados?** Si DHGS corre varias veces, las rutas se mezclarán.
   - Crear `PlanningRunEntity` (`Long id`, `LocalDateTime fechaEjecucion`, `String escenario`, `Double costoTotal`, etc.).
   - Modificar `RutaEnvioEntity` para que pertenezca a un `PlanningRunEntity`.

---

## FASE 3: Capa de Acceso a Datos (Repositorios) y Mappers
**Objetivo:** Crear repositorios y establecer explícitamente la conversión entre Persistencia y Dominio Algorítmico.

1. **Crear Repositorios Faltantes**
   - `AirportRepository`, `FlightRepository`, `ShipmentRepository`, `RutaEnvioRepository`, `PlanningRunRepository`.
2. **Crear Mappers (Entity ↔ Domain)**
   - **¿Cómo se mapea?** El algoritmo en `com.tasfb2b.dhgs.demo.domain.model` **NO** usa JPA.
   - Crear clases de mapeo (ej. `MapStruct` o clases manuales) para convertir `AirportEntity` a `Aeropuerto`, `FlightEntity` a `Vuelo`, y `ShipmentEntity` a `Envio`.
   - **Exclusión explícita:** Recordar que clases como `InstanciaVuelo` y `AlmacenEstado` son de *runtime* puramente temporal y **no se mapean** a entidades de persistencia estáticas.

---

## FASE 4: Capa de Servicio y Controladores (CRUD API REST)
**Objetivo:** Exponer la gestión de datos siguiendo buenas prácticas de Spring.

1. **Implementar Controladores Seguros**
   - Crear `AirportController`, `FlightController`, `ShipmentController`.
   - **Antipatrón a evitar:** No exponer entidades JPA directamente. Crear `AirportDTO`, `FlightDTO` para las respuestas.
   - Asegurarse de implementar paginación (`Pageable`) en listas grandes como los Envíos o Vuelos.
   - (Asegurarse de tener `spring.jpa.open-in-view=false` en el properties).

---

## FASE 5: Refactor del Planificador (Hacia Base de Datos)
**Objetivo:** Modificar `OptimizationService` para que lea de la base de datos en vez de los archivos `.txt`.

1. **Refactor de la firma de carga de datos**
   - Actualmente `OptimizationService` lee paths de archivos `.txt`.
   - **Refactor explícito:** Modificar la inyección de datos para que en lugar de invocar `AeropuertoParser.parse()`, se llame a `airportRepository.findAll()` y luego se use el Mapper para convertirlos a `List<Aeropuerto>`.
2. **Persistencia del Resultado**
   - Al finalizar la ejecución del algoritmo, crear un nuevo `PlanningRunEntity`.
   - Recorrer el `Individuo` ganador, convertir cada `RutaEnvio` del dominio a `RutaEnvioEntity`, asociarlas al `PlanningRunEntity` y persistirlas en el `RutaEnvioRepository`.

---

## FASE 6: Estrategia de Pruebas
**¿Cómo se prueba?**
1. Crear tests de integración de BD usando `@DataJpaTest` para verificar los mapeos (especialmente los tipos como `duracionMinutos` y las secuencias de vuelos).
2. Crear `@WebMvcTest` para verificar la paginación y mapeo DTO en los Controladores.
