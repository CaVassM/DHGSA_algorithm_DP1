# Contexto de Datos y Arquitectura de Solución (Actualizado desde Código)

Este documento centraliza el conocimiento extraído del modelo de dominio real del repositorio (y los documentos de diseño) para la construcción consistente del Backend. 

## 1. Entidades de Datos Principales (Dominio vs Persistencia)

El sistema opera sobre cuatro conceptos fundamentales. Existe una clara separación entre los **Modelos de Dominio** del algoritmo legado (`com.tasfb2b.dhgs.demo.domain.model`) y las **Entidades JPA** del backend moderno (`com.tasfb2b.backend.domain.model`).

### 1.1 Aeropuerto
Nodo en el grafo de transporte.
- **Dominio (`Aeropuerto.java`):** 
  - Atributos: `id` (int), `codigoICAO` (String), `ciudad`, `pais`, `continente`, `capacidadAlmacen`, `latitud`, `longitud`, `gmt`.
  - Regla: Distancia calculada con Haversine (`getDistanciaA`).
- **Persistencia (`AirportEntity.java`):**
  - Mapeo: `Long id` (surrogate PK), `Integer idNegocio` (business ID).
  - Preserva `codigoIcao` como único.

### 1.2 Vuelo (Plantilla)
Arco dirigido en el grafo con horarios fijos y capacidad limitada.
- **Dominio (`Vuelo.java`):** 
  - Atributos: `id` (String semántico), `aeropuertoOrigen`, `aeropuertoDestino`, `horaSalida`, `horaLlegada`, `capacidad`, `capacidadDisponible`, `distancia`, `duracion` (`java.time.Duration`).
  - Regla: `getTiempoVuelo()` maneja cruces de medianoche.
- **Persistencia (`FlightEntity.java`):**
  - Mapeo: `Long id` (surrogate PK), `String businessId` (business ID único).
  - La duración de `java.time.Duration` se mapea de forma plana a `Long duracionMinutos`.
  - Incluye `capacidadDisponible`.

### 1.3 Envío
Solicitud de transporte de maletas de un cliente.
- **Dominio (`Envio.java`):** 
  - Atributos: `id` (String), `aeropuertoOrigen`, `aeropuertoDestino`, `fechaHoraCreacion`, `cantidadMaletas`, `idCliente`, `deadline`, `esMustGo`, `prioridad`.
  - Regla: El `deadline` es creación + 1 o 2 días según el continente. `actualizarMustGo()` recalcula si un envío es urgente según la época.
- **Persistencia (`ShipmentEntity.java`):**
  - Mapeo: `Long id` (surrogate PK), `String businessId` (business ID único).
  - Preserva íntegramente los campos críticos del algoritmo: `esMustGo` y `prioridad`.

### 1.4 RutaEnvio (Salida del algoritmo)
Plan de viaje asignado a un envío por el planificador.
- **Dominio (`RutaEnvio.java`):**
  - Atributos: `envio`, `secuenciaVuelos` (`List<InstanciaVuelo>`), `tiempoInicio`, `tiempoLlegadaEstimado`, `distanciaTotal`, `esDirecta`, `escalas`.
- **Persistencia (Pendiente de mapear a Entity):**
  - Al crearse, debe guardar explícitamente el equivalente a la `secuenciaVuelos` como un componente core.

## 2. Decisiones Arquitectónicas (Backend y Algoritmo)

- **Mapeo Objeto-Relacional (Mappers):** Al persistir la simulación, se debe hacer una conversión explícita entre las entidades JPA (ej. `ShipmentEntity`) y las clases de dominio que el algoritmo puro de la simulación requiere (`Envio`).
- **Estados Dinámicos vs Persistencia:** Entidades como `InstanciaVuelo.java` (vuelos materializados diarios) y `AlmacenEstado.java` operan estrictamente en *runtime* durante la ejecución de las épocas y no se mapean a tablas persistentes fijas.
- **Identificadores:** Se aplica un patrón estricto donde los IDs primarios de JPA (`@Id Long id`) son **surrogates**, y la trazabilidad con los `.txt` y el algoritmo se preserva mediante columnas de negocio específicas (`businessId` o `idNegocio` con índices únicos).
