# Planificador de Tasf.B2B — explicación simple

## 1. Qué hice

Antes tenías **dos mundos separados**:

- el mundo nuevo `com.tasfb2b.backend` con estructura MVC, pero todavía vacío o de prueba
- el mundo viejo `DHGS.demo` donde realmente vivía el algoritmo

Lo que hice fue **conectarlos para que el planificador nuevo use el algoritmo real**.

En otras palabras:

- el endpoint nuevo del planificador **ya no es decorativo**
- ahora `PlanningService` ejecuta el flujo real del optimizador
- el algoritmo viejo pasa a funcionar como el **motor interno** del nuevo componente planificador

---

## 2. Cómo queda la idea general

```text
Cliente / Frontend
      |
      v
PlanningController
      |
      v
PlanningService
      |
      v
OptimizationService   <- aquí vive la orquestación real
      |
      +--> parsers de datos
      +--> simulador de épocas
      +--> grafo de vuelos
      +--> DHGS o IALNS
      |
      v
PlanningResponse
```

---

## 3. Qué archivo hace qué cosa

### `PlanningController`
Recibe la petición HTTP.

Ejemplo mental:
> “quiero correr el planificador desde tal fecha, por tantos días, con tal algoritmo”

### `PlanningService`
Es el **traductor** entre el backend nuevo y el algoritmo real.

Hace estas cosas:

1. recibe un `PlanningRequest`
2. decide qué dataset usar (`demo` o `real`)
3. convierte el request nuevo al request viejo del optimizador
4. llama a `OptimizationService`
5. convierte el resultado a `PlanningResponse`

### `OptimizationService`
Es el cerebro actual que ya existía.

Se encarga de:

1. leer aeropuertos, vuelos y envíos
2. armar el horizonte de simulación
3. separar por épocas
4. correr DHGS o IALNS
5. devolver métricas y resultados

---

## 4. Flujo paso a paso

```text
[POST /api/v1/planner/runs]
            |
            v
[PlanningRequest]
            |
            v
[PlanningService]
  - valida algoritmo
  - resuelve dataset
  - arma OptimizationRequest
            |
            v
[OptimizationService]
  - parsea datos
  - organiza épocas
  - construye grafo
  - ejecuta algoritmo
            |
            v
[OptimizationResponse]
            |
            v
[PlanningResponse]
            |
            v
[Respuesta al frontend]
```

---

## 5. Qué devuelve ahora el planificador

Ya no devuelve solo un “TODO”.

Ahora devuelve cosas reales como:

- algoritmo usado
- escenario usado
- dataset usado
- total de épocas
- épocas procesadas
- costo total
- cuántos envíos se asignaron
- cuántos no se asignaron
- cuántas maletas se movieron
- si la simulación terminó completa o con pendientes
- tiempo de ejecución
- resumen por época
- rutas calculadas

---

## 6. Cómo decide qué dataset usar

Hoy el sistema usa esta lógica simple:

- si `dataSetReference = demo` o `test` -> usa dataset pequeño de prueba
- si `dataSetReference = real` -> usa dataset real
- si no mandas nada:
  - `PERIOD_SIMULATION` usa `demo`
  - `REAL_TIME` y `COLLAPSE_SIMULATION` usan `real`

### Importante
El escenario **colapso** todavía no tiene reglas especiales de colapso.
Por ahora usa la lógica normal del planificador y solo deja esa nota en el mensaje.

---

## 7. Qué archivos toqué conceptualmente

### Integración principal
- `modules/backend/src/main/java/com/tasfb2b/backend/TasfB2BBackendApplication.java`
- `modules/backend/src/main/java/com/tasfb2b/backend/controller/PlanningController.java`
- `modules/backend/src/main/java/com/tasfb2b/backend/service/PlanningService.java`
- `modules/backend/src/main/java/com/tasfb2b/backend/dto/request/PlanningRequest.java`
- `modules/backend/src/main/java/com/tasfb2b/backend/dto/response/PlanningResponse.java`

### Motor real aprovechado
- `modules/backend/src/main/java/com/tasfb2b/dhgs/demo/application/service/OptimizationService.java`

### Configuración
- `modules/backend/src/main/resources/application.properties`

### Validación
- prueba nueva de integración del planificador

---

## 8. Qué falta configurar todavía

Esto es lo más importante para ti.

### A. Rutas de datos
Hoy el planificador toma los datos desde rutas pensadas para desarrollo local.
Eso sirve para trabajar y probar, pero después conviene moverlo a algo más ordenado, por ejemplo:

- una carpeta `data/` real del proyecto
- variables de entorno
- base de datos
- storage externo

### B. Escenario de colapso
Todavía **no existe una lógica especial** que diga por ejemplo:

- vuelos cancelados
- aeropuertos saturados
- almacenes colapsados
- replanificación por incidentes

Eso aún falta modelarlo.

### C. Tiempo real real
Hoy el modo “tiempo real” todavía corre como simulación con datos cargados.
Más adelante faltará conectar:

- eventos en vivo
- WebSocket
- actualizaciones incrementales
- nuevas corridas sin reiniciar todo

### D. Limpieza final de paquetes
Ahora conviven dos módulos lógicos, pero ya con namespaces consistentes:

- `com.tasfb2b.backend`
- `com.tasfb2b.dhgs.demo`

O sea: **ya está fusionado funcionalmente** y el optimizador legacy quedó como motor interno del planner.
La siguiente etapa ideal sería mover clases del algoritmo a paquetes backend más limpios, por ejemplo:

- `planner/service`
- `planner/domain`
- `planner/algorithm`
- `planner/infra`

### E. Persistencia
El planificador corre en memoria.
Todavía falta decidir qué se guardará en:

- PostgreSQL
- Redis
- MongoDB

---

## 9. Estado actual resumido

### Ya quedó hecho
- el backend MVC nuevo ya llama al algoritmo real
- el planificador nuevo ya sirve para ejecutar DHGS o IALNS
- ya no devuelve un placeholder vacío
- ya devuelve métricas y rutas
- ya existe una prueba del flujo del planificador

### Aún falta después
- colapso real
- tiempo real real
- persistencia
- limpieza total de paquetes y nombres
- definir mejor cómo el frontend consumirá esto

---

## 10. Si quieres visualizarlo rápido

```text
ANTES
------
Nuevo backend MVC        -> casi vacío
Algoritmo viejo          -> separado

AHORA
-----
Nuevo backend MVC        -> manda
PlanningService          -> conecta
OptimizationService      -> ejecuta
DHGS / IALNS             -> resuelven
```

---

## 11. Qué te recomiendo como siguiente paso

Orden sugerido:

1. usar ya `PlanningController` como endpoint oficial
2. probarlo desde Postman o frontend
3. definir qué escenario/dataset usarás por defecto
4. decidir si quieres:
   - limpiar nombres y paquetes ahora
   - o primero terminar funcionalidades

---

## 12. Ejemplo mental de petición

```text
“Quiero correr el planificador con DHGS,
para simulación de período,
comenzando el 2026-01-01,
por 2 días,
usando el dataset demo.”
```

El backend ahora sí toma eso y lo convierte en una ejecución real del algoritmo.

