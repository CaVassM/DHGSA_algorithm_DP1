# Roadmap para Construcción del Frontend (Fase N+1)

Este roadmap define la arquitectura inicial y los pasos de integración para que la capa frontend (`modules/frontend`) pase de ser un esqueleto vacío a una aplicación funcional, consumiendo los nuevos endpoints REST del backend.

---

## 1. Auditoría de Endpoints Actuales (Backend Listo)
Claude ha implementado exitosamente:
- **`AdminImportController`**: Endpoints `POST` (`/api/v1/admin/imports/*`) con soporte multipart (`MultipartFile`) para hacer seeding de la base de datos subiendo los `.txt`.
- **`AirportController`, `FlightController`, `ShipmentController`**: Endpoints `GET` con paginación (`Pageable`) e inyección de DTOs para evitar exponer JPA.
- **`PlanningController`**: El orquestador para correr la simulación (`POST /api/v1/planner/runs`).

---

## 2. Inicialización del Entorno y Build Tool
**Situación actual:** El `package.json` solo tiene React y Axios sin motor de empaquetado.

1. **Migración a Vite**
   - El ejecutor debe instalar Vite como build tool para tener HMR y compilación rápida.
   - Instalar dependencias necesarias: `npm install -D vite @vitejs/plugin-react`.
   - Crear el `vite.config.ts` y configurar el puerto (ej. `3000`).
   - Configurar un proxy en Vite (`server.proxy`) para redirigir `/api` a `http://localhost:8080` y evitar problemas de CORS durante el desarrollo.

2. **Arquitectura de Carpetas Frontend**
   - Crear estructura estándar bajo `modules/frontend/src/`:
     - `api/` (Instancia de Axios y llamadas a endpoints)
     - `components/` (Componentes reutilizables)
     - `pages/` (Vistas principales)
     - `assets/` (Estilos Vanilla CSS globales y media)
     - `types/` (Interfaces TypeScript para los DTOs)

---

## 3. Capa de Integración (API Client)
**Objetivo:** Establecer una comunicación segura y tipada con el backend.

1. **Definir DTOs en TypeScript (`src/types/`)**
   - Crear interfaces idénticas a los DTOs de Java: `AirportResponse`, `FlightResponse`, `ShipmentResponse`, `ImportSummaryResponse`, `PlanningRequest`.
2. **Configurar Axios (`src/api/client.ts`)**
   - Crear una instancia de Axios apuntando a la base url (vía proxy).
   - Implementar interceptores genéricos para el manejo de errores (mostrar notificaciones si el backend falla).

---

## 4. Diseño de Interfaz y Vistas Principales (UI)
**Directiva de Diseño:** *Premium, moderno, glassmorphism, vibrante.* Se usará Vanilla CSS (sin Tailwind) para mantener control total sobre las micro-animaciones y gradientes.

1. **Página de Inicialización (Admin Data Seeding)**
   - **Endpoint:** `POST /api/v1/admin/imports/*`
   - **Funcionalidad:** Formularios drag-and-drop para subir los archivos `estudiantes_real.txt`, `planes_vuelo_real.txt`, y los envíos. Mostrar `ImportSummaryResponse` (total insertado) al terminar.
2. **Dashboard de Entidades (Master Data)**
   - **Endpoints:** `GET` a `/airports`, `/flights`, `/shipments`.
   - **Funcionalidad:** Tablas con diseño moderno (efectos hover, dark-mode opcional) que soporten la paginación que el backend ya entrega.
3. **Panel de Simulación (El Core del Proyecto)**
   - **Endpoint:** `POST /api/v1/planner/runs`
   - **Funcionalidad:** 
     - Controles para seleccionar: Algoritmo (DHGS/IALNS), Días de Horizonte, Tamaño de Población.
     - Botón flotante animado para iniciar la optimización.
     - Pantalla de carga dinámica mientras el algoritmo corre.
     - **Visualización de Resultados:** Gráficos o cards resumiendo costo, maletas despachadas, envíos pendientes y las métricas de `PlanningResponse`.

---

## 5. Instrucciones Operativas para Claude Code
Al ejecutar este roadmap, Claude debe:
1. **Evitar instalar TailwindCSS** (por directiva del proyecto, nos apegaremos a Vanilla CSS de alto nivel).
2. Priorizar el **Data Seeding View** primero, ya que sin datos las otras pantallas se verán vacías.
3. Si requiere agregar un enrutador, usar `react-router-dom`.
4. Proceder fase por fase, haciendo commit al completar el `setup` antes de programar las vistas.
