# TEMPLATE — Flujo: [Nombre del Flujo]
> Copiar este archivo como `flujo-[nombre-kebab].md` para documentar un nuevo flujo.
> Llenar todas las secciones. Entre más detalle, menos tiempo perderá Claude explorando.

---

## 📋 Descripción
**Qué hace este flujo**: [Una línea describiendo el propósito]
**Microservicio principal**: [back-ventaproceso / back-mantenimiento / etc.]
**Última actualización**: [YYYY-MM-DD]
**Documentado por**: [nombre o "Claude CLI"]

---

## 🚀 Trigger
**Cómo se inicia este flujo**:
- Endpoint: `[MÉTODO] /ruta/del/endpoint`
- Acción de usuario: [qué hace el usuario en el frontend]
- Componente Angular: `[ruta/al/componente.ts]`

---

## 🗂️ Archivos involucrados (en orden de ejecución)

### Frontend
```
front/.../componente.ts          → [qué hace aquí]
front/.../servicio.service.ts    → [método que llama]
```

### Backend
```
back-[servicio]/API/Controllers/[Controlador].cs         → [endpoint y acción]
back-[servicio]/Application/Interface/I[Servicio].cs     → [método de la interface]
back-[servicio]/Application/Implementation/[Servicio].cs → [lógica de negocio]
back-[servicio]/Core/Entities/[Entidad].cs               → [entidad involucrada]
back-[servicio]/Core/Request/[Request].cs                → [DTO de entrada]
back-[servicio]/Core/Response/[Response].cs              → [DTO de salida]
back-[servicio]/Infrastructure/Repository/[Repo].cs      → [consulta a BD]
back-[servicio]/Infrastructure/Context/[Context].cs      → [DbContext usado]
```

---

## 🔄 Flujo paso a paso

```
1. Usuario hace [acción] en el componente [nombre]
2. Componente llama [servicio.método(params)]
3. Servicio Angular hace POST/GET a [endpoint]
4. Controller recibe request → valida con FluentValidation
5. Controller llama [IServicio.método(request)]
6. Service obtiene IdUsuario desde GetIdUser()
7. Service llama [IRepositorio.método(params)]
8. Repositorio ejecuta query EF Core:
   - Filtra por [campo] con visibilidad por rol (si aplica)
   - Incluye tablas relacionadas: [lista]
9. Repositorio retorna [tipo de dato]
10. Service construye response y retorna OperationResponse.ResultOk(data)
11. Controller retorna Ok(response)
12. Frontend recibe respuesta y [actualiza UI / navega / muestra toast]
```

---

## 🗃️ Query principal (si aplica)
```csharp
// Descripción de qué hace esta query
var resultado = await _context.NombreTabla
    .Where(x => x.Estado == Flags.Habilitado
             && x.IdEntidad == idParam)
    .Include(x => x.RelacionNombre)
    .OrderByDescending(x => x.FechaCreacion)
    .ToListAsync();
```

---

## ⚠️ Puntos críticos / Gotchas
- [Algo que no es obvio y puede causar bugs]
- [Dependencia con otro servicio o tabla]
- [Comportamiento especial según rol]

---

## 🐛 Errores comunes y soluciones
| Error | Causa | Solución |
|-------|-------|---------|
| [mensaje de error] | [por qué ocurre] | [cómo resolverlo] |

---

## 🔗 Flujos relacionados
- `flujos/flujo-[otro-flujo].md` — [por qué está relacionado]
