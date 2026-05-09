# Tasf.B2B

## Descripción del proyecto

Tasf.B2B es un sistema para la gestión y planificación de equipajes extraviados entre aeropuertos. La base del repositorio queda preparada para una arquitectura modular con dos frentes de trabajo:

- **Planificador**: módulo principal orientado a la ejecución futura del algoritmo **IALNS-SA**.
- **Visualizador**: módulo cliente que consumirá la información expuesta por el backend.

En esta fase se deja únicamente la estructura necesaria para trabajo paralelo del equipo, sin agregar lógica nueva de negocio.

## Arquitectura general

- **Backend**: Spring Boot 3.x con patrón MVC y separación por `controller`, `service`, `repository`, `domain/model`, `dto`, `config` y `exception`.
- **Frontend**: organización base para React + TypeScript sin componentes visuales implementados.
- **Infraestructura**: base inicial para Docker Compose y servicios auxiliares.
- **Migración controlada**: el código actual en `src/` se conserva como implementación legada mientras la nueva estructura en `modules/` se consolida.

## Stack tecnológico

### Backend

- Java 17+ (baseline actual del repositorio: Java 21)
- Spring Boot 3.x
- Spring MVC
- WebSocket
- JPA/Hibernate como integración prevista
- PostgreSQL, Redis y MongoDB como servicios objetivo

### Frontend

- React 18+
- TypeScript
- Axios
- Material UI o Tailwind
- Recharts o D3.js

### Infraestructura

- Docker
- Docker Compose
- Nginx

## Estructura de carpetas

```text
.
├── .github/
│   └── workflows/
├── data/
├── deploy/
├── docs/
├── modules/
│   ├── backend/
│   │   ├── pom.xml
│   │   └── src/main/java/com/tasfb2b/backend/
│   │       ├── config/
│   │       ├── controller/
│   │       ├── domain/
│   │       │   ├── enums/
│   │       │   └── model/
│   │       ├── dto/
│   │       │   ├── request/
│   │       │   └── response/
│   │       ├── exception/
│   │       ├── repository/
│   │       └── service/
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
├── tests/
├── utils/
└── docker-compose.yml
```


## Escenarios operativos

El sistema se prepara para tres escenarios funcionales:

- **Tiempo real**
- **Simulación de período**
- **Simulación de colapso**

El planificador queda nombrado para priorizar **IALNS-SA** como algoritmo principal, manteniendo **DHGS** como referencia o respaldo comparativo.

## Documentación relacionada

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`PSEUDOCODE.md`](PSEUDOCODE.md)
- [`RESULTS.md`](RESULTS.md)
- [`HELP.md`](HELP.md)
