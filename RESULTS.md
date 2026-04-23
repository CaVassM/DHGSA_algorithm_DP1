# Interpretación de Resultados — Algoritmo DHGS

Este documento explica cómo leer e interpretar cada valor que aparece en la consola al ejecutar los tests del algoritmo DHGS.

---

## Resumen del Objeto Solución (`Individuo`)

Cuando el algoritmo termina, devuelve un `Individuo` que representa la **mejor solución encontrada**. Sus campos son:

| Campo | Tipo | Qué significa |
|---|---|---|
| `enviosAsignados` | `Map<Envio, RutaEnvio>` | Cada envío con la ruta de vuelos que se le asignó |
| `enviosNoAsignados` | `List<Envio>` | Envíos que no pudieron rutarse (se postponen) |
| `fitness` | `double` | Valor objetivo global. **Menor = mejor** |
| `costoDistanciaTotal` | `double` | Componente de distancia del fitness (sin penalizaciones) |
| `violacionesCapacidad` | `double` | Suma cuadrática de excesos de carga en vuelos |
| `violacionesTiempo` | `double` | Suma cuadrática de retrasos respecto al deadline |
| `lateness` | `double` | Suma lineal de retrasos (minutos totales acumulados) |
| `esFactible` | `boolean` | `true` si la solución no viola ninguna restricción dura |

---

## La Función de Fitness — Cómo Leerla

El fitness combina cuatro componentes:

```
fitness = costoDistancia
        + 1000 × violacionesCapacidad
        + 5000 × violacionesTiempo
        + penalizacionNoAsignados
```

### Componente 1 — `costoDistanciaTotal`
- Unidad: km × maletas
- Ejemplo: `12540.00` significa que se transportaron maletas recorriendo un total ponderado de 12 540 km
- **Cuanto menor, mejor**: el algoritmo buscó rutas más cortas para los envíos con más maletas

### Componente 2 — `violacionesCapacidad`
- Unidad: (maletas en exceso)² por vuelo, sumado sobre todos los vuelos sobrecargados
- Si es `0.0` → ningún vuelo supera su capacidad declarada
- Si es positivo → hay vuelos con más maletas de las que caben. La penalización es **cuadrática** (un exceso de 10 maletas suma 100, no 10), lo que hace que el algoritmo evite fuertemente las sobrecargas grandes

### Componente 3 — `violacionesTiempo`
- Unidad: minutos² de retraso, sumado sobre todos los envíos que llegaron tarde
- Si es `0.0` → todos los envíos asignados llegaron antes de su deadline
- Si es positivo → algunos envíos llegan después de su deadline. Al igual que capacidad, la penalización es cuadrática

### Componente 4 — Penalización por no asignados (implícita en `fitness`)
- Cada envío no asignado agrega una penalización mínima de 10 000
- Los `mustGo` (envíos críticos) tienen una penalización 5× mayor que los opcionales
- Esto garantiza que el algoritmo priorice asignar los envíos críticos antes que minimizar distancia

### ¿Cómo saber si el fitness es "bueno"?
- Un fitness **puramente de distancia** (sin penalizaciones) es el ideal
- Si `fitness ≈ costoDistanciaTotal` → solución factible sin violaciones
- Si `fitness >> costoDistanciaTotal` → hay violaciones activas. Revisar `violacionesCapacidad` y `violacionesTiempo`

---

## El Campo `esFactible`

| Valor | Qué significa |
|---|---|
| `true` | La solución **no tiene violaciones** de capacidad ni de tiempo, y todos los `mustGo` están asignados |
| `false` | Existen violaciones activas. La solución es válida como resultado (es la mejor que el algoritmo encontró en el tiempo dado), pero debe interpretarse con cautela |

> **Nota:** Una solución infactible no es necesariamente un error. Puede ocurrir cuando el tiempo de ejecución es corto, la red de vuelos tiene poca conectividad, o hay demasiados envíos `mustGo` para la capacidad disponible.

---

## Rutas Asignadas

Cada línea del bloque `RUTAS ASIGNADAS` tiene este formato:

```
[ID_ENVIO] ORIGEN->DESTINO (N maletas) via: VUE1->VUE2 -> VUE3->DEST | dist=XXXX km | costo=YYYY
```

| Campo | Explicación |
|---|---|
| `ID_ENVIO` | Identificador único del envío |
| `ORIGEN->DESTINO` | Par de aeropuertos ICAO origen y destino del envío |
| `N maletas` | Cantidad de maletas que transporta este envío |
| `via: ...` | Secuencia de vuelos utilizados (cada segmento es un vuelo real) |
| `dist=XXXX km` | Distancia total de la ruta en kilómetros |
| `costo=YYYY` | Costo de esa ruta (distancia × maletas) |

### Ejemplo interpretado:

```
[E-001] SKBO->SCEL (3 maletas) via: SKBO->SPIM -> SPIM->SCEL | dist=3200 km | costo=9600
```
- El envío `E-001` sale de Bogotá (SKBO) hacia Santiago (SCEL)
- Lleva 3 maletas y hace escala en Lima (SPIM)
- La distancia total del trayecto es 3 200 km
- El costo ponderado es 9 600 (3 200 km × 3 maletas)

---

## Envíos No Asignados

```
[ID_ENVIO] ORIGEN->DESTINO (N maletas) mustGo=true/false
```

- `mustGo=true` → envío crítico que **debería haberse asignado**. Si aparece aquí, es una señal de alerta: la red no tiene conectividad entre esos aeropuertos, o el tiempo de ejecución fue insuficiente
- `mustGo=false` → envío opcional postponido. Normal si la capacidad de los vuelos está saturada

---

## Bloque de Validación

Al final de cada test aparece:

```
=== VALIDACION ===
  Sin violaciones -- solucion completamente factible
```
o:
```
=== VALIDACION ===
  3 violaciones encontradas:
  [!] Vuelo VU-045 sobrecargado: 12 maletas, capacidad 10
  [!] Envio E-023 llega tarde: 45 min despues del deadline
```

Las violaciones reportadas por el `Validador` son las **verificaciones finales** sobre la solución retornada. Reflejan lo mismo que `violacionesCapacidad` y `violacionesTiempo`, pero en forma legible.

---

## Métricas de Población (Logs de DEBUG)

En los logs de nivel `DEBUG` verás líneas como:

```
Iteracion 100: ratio factibles=0.40, params=ParametrosPenalizacion{penCap=1200.0, penTime=6000.0}
```

| Campo | Significado |
|---|---|
| `ratio factibles` | Fracción de individuos en la población que son factibles (0.0–1.0) |
| `penCap` | Penalización actual por violación de capacidad (empieza en 1 000) |
| `penTime` | Penalización actual por violación de tiempo (empieza en 5 000) |

**Regla de ajuste automático:**
- Si `ratio < 0.20` → pocas soluciones factibles → el algoritmo sube las penalizaciones 20% para presionar hacia factibilidad
- Si `ratio > 0.80` → demasiadas factibles, poca exploración → baja las penalizaciones 15% para diversificar

---

## Bloque de Resumen en Consola

```
╔══════════════════════════════════════════════════╗
║  RESULTADO DHGS: 50 ENVIOS REALES                ║
╠══════════════════════════════════════════════════╣
║  Tiempo ejecucion:    8732                    ms ║
║  Envios asignados:    47                         ║
║  Envios no asignados: 3                          ║
║  Fitness:             198450.32                  ║
║  Costo distancia:     192340.00                  ║
║  Viol. capacidad:     0.00                       ║
║  Viol. tiempo:        0.00                       ║
║  Lateness:            0.00                       ║
║  Factible:            true                       ║
╚══════════════════════════════════════════════════╝
```

**Interpretación del ejemplo:**
- El algoritmo ejecutó durante ~8.7 s
- Asignó 47 de 50 envíos (94%). Los 3 restantes no tenían ruta disponible en la red
- `fitness ≈ costoDistancia` → no hay penalizaciones activas → **solución factible**
- `violacionesCapacidad = 0` y `violacionesTiempo = 0` → **ninguna restricción dura violada**
- `esFactible = true` → resultado **listo para usar**

---

## Distribución por Continente

```
=== DISTRIBUCIÓN POR CONTINENTE ===
  Asia->Asia: 87 envios
  Europa->Europa: 64 envios
  Asia->Europa: 23 envios
```

Muestra de dónde a dónde van los envíos asignados. Útil para detectar si el algoritmo está favoreciendo rutas regionales sobre intercontinentales.

---

## Comparación de Fitness entre Escalas

```
=== COMPARACIÓN FITNESS ===
  50  envios: fitness=198450.32, asignados=47, distancia=192340.00
  200 envios: fitness=760210.44, asignados=186, distancia=748120.00
```

- El fitness escala aproximadamente lineal con el número de envíos asignados
- Si `fitness/envío` de 200 envíos es mucho mayor que el de 50, puede indicar que la red está saturada y hay más violaciones activas en escala grande

---

## Señales de Alerta

| Situación | Causa probable | Acción |
|---|---|---|
| `esFactible = false` con `violacionesCapacidad > 0` | Capacidad de vuelos insuficiente para los envíos | Revisar datos de vuelos o reducir envíos por época |
| `esFactible = false` con `violacionesTiempo > 0` | Deadlines muy ajustados o rutas con muchas escalas | Ampliar ventana temporal de épocas |
| `enviosNoAsignados` contiene `mustGo=true` | Aeropuerto origen/destino no conectado en el grafo | Verificar que existan vuelos que cubran ese par de aeropuertos |
| `fitness` mucho mayor que `costoDistancia` | Penalizaciones dominando | Aumentar tiempo de ejecución (`limiteTiempo`) |
| Algoritmo termina por "estancamiento" antes del límite | Poca diversidad en la población | Aumentar tamaño de población (`tamanoPoblacion`) |

---

## Parámetros de Ejecución y su Efecto

| Parámetro | Valor típico | Efecto al aumentar |
|---|---|---|
| `limiteTiempo` | 5–10 s | Más iteraciones → mejor fitness, más tiempo |
| `tamanoPoblacion` | 15–25 | Más diversidad → menos estancamiento, más memoria |
| `DURACION_EPOCA_HORAS` | 4 h | Ventana más amplia → más envíos por época, más complejidad |
| `penCap` inicial | 1 000 | Mayor penalización → busca factibilidad más rápido |
| `penTime` inicial | 5 000 | Mayor penalización → prioriza cumplir deadlines |

