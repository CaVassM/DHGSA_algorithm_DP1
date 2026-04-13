# Pseudocódigo — Algoritmo DHGS para Asignación de Maletas a Vuelos

## Entrada

```
ENTRADA:
  envios[]         ← Lista de envíos (origen, destino, maletas, deadline, esMustGo)
  vuelos[]         ← Lista de vuelos (origen, destino, horaSalida, horaLlegada, capacidad)
  aeropuertos[]    ← Lista de aeropuertos (ICAO, coordenadas, capacidadAlmacén)
  epocaActual      ← Número de época
  totalEpocas      ← Total de épocas en simulación
  limiteTiempo     ← Tiempo máximo de ejecución
```

## Salida

```
SALIDA:
  mejorSolucion    ← Individuo con: envío → secuencia de vuelos
```

---

## Fase 0: Construcción del Grafo

```
FUNCIÓN construirGrafo(aeropuertos, vuelos):
    grafo ← nuevo GrafoDirigido

    PARA CADA aeropuerto EN aeropuertos:
        grafo.agregarNodo(aeropuerto.ICAO)

    PARA CADA vuelo EN vuelos:
        grafo.agregarArco(
            origen  = vuelo.aeropuertoOrigen.ICAO,
            destino = vuelo.aeropuertoDestino.ICAO,
            peso    = vuelo.duracionMinutos
        )

    // Precalcular matriz de distancias (Haversine)
    PARA CADA par (a, b) EN aeropuertos × aeropuertos:
        matrizDistancias[a][b] = haversine(a.lat, a.lon, b.lat, b.lon)

    RETORNAR grafo
```

---

## Fase 1: SPLIT (Asignación Envío → Ruta)

```
FUNCIÓN split(giantTour, grafo):
    asignaciones ← mapa vacío

    PARA CADA envio EN giantTour:
        ruta ← dijkstra(grafo, envio.origen, envio.destino)

        SI ruta NO está vacía:
            rutaEnvio ← nueva RutaEnvio(envio, ruta)
            rutaEnvio.calcularTiempos()
            asignaciones[envio] = rutaEnvio

    RETORNAR asignaciones
```

---

## Fase 2: Función de Fitness

```
FUNCIÓN calcularFitness(individuo):

    // === Componente 1: Distancia total ===
    distanciaTotal ← 0
    PARA CADA (envio, ruta) EN individuo.enviosAsignados:
        distanciaTotal += ruta.distanciaTotal × envio.cantidadMaletas

    // === Componente 2: Violación de capacidad (cuadrática) ===
    cargaPorVuelo ← mapa vacío
    PARA CADA (envio, ruta) EN individuo.enviosAsignados:
        PARA CADA vuelo EN ruta.secuenciaVuelos:
            cargaPorVuelo[vuelo] += envio.cantidadMaletas

    violCapacidad ← 0
    PARA CADA (vuelo, carga) EN cargaPorVuelo:
        exceso ← max(0, carga - vuelo.capacidad)
        violCapacidad += exceso²                     ← CUADRÁTICA

    // === Componente 3: Violación de tiempo (cuadrática) ===
    violTiempo ← 0
    PARA CADA (envio, ruta) EN individuo.enviosAsignados:
        retraso ← max(0, ruta.tiempoLlegada - envio.deadline) EN minutos
        violTiempo += retraso²                       ← CUADRÁTICA

    // === Componente 4: Penalización por envíos no asignados ===
    penNoAsignados ← 0
    PARA CADA envio EN individuo.enviosNoAsignados:
        costoEstimado ← distancia(envio.origen, envio.destino) × envio.maletas
        SI envio.esMustGo:
            penNoAsignados += max(10000, costoEstimado × 10)
        SINO:
            penNoAsignados += max(10000, costoEstimado × 2)

    // === Fitness final ===
    fitness ← distanciaTotal
            + 1000 × violCapacidad
            + 5000 × violTiempo
            + penNoAsignados

    RETORNAR fitness     ← (menor = mejor)
```

---

## Fase 3: Población Inicial

```
FUNCIÓN generarPoblacionInicial(envios, tamaño):
    poblacion ← lista vacía

    // Solución 1: Greedy (todos los envíos, ordenados por prioridad)
    greedy ← ordenar envios por prioridad descendente
    poblacion.agregar(split(greedy))

    // Solución 2: Lazy (solo must-go)
    mustGo ← filtrar envios donde esMustGo = true
    poblacion.agregar(split(mustGo))

    // Soluciones 3..N: Aleatorias con probabilidad variable
    probabilidades ← [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]
    MIENTRAS poblacion.tamaño < tamaño:
        p ← elegir aleatorio de probabilidades
        subconjunto ← mustGo + (opcionales con probabilidad p)
        permutar aleatoriamente subconjunto
        poblacion.agregar(split(subconjunto))

    RETORNAR poblacion
```

---

## Fase 4: Loop Genético Principal

```
FUNCIÓN ejecutarDHGS(envios, epocaActual, totalEpocas, tamañoPob, limiteTiempo):

    grafo    ← construirGrafo(aeropuertos, vuelos)
    poblacion ← generarPoblacionInicial(envios, tamañoPob)
    penCap   ← 1000
    penTime  ← 5000
    iteracion ← 0

    MIENTRAS (tiempo < limiteTiempo) Y (NO estancada(poblacion)):
        iteracion++

        // ─── 1. SELECCIÓN DE PADRES (torneo binario) ───
        padre1 ← torneoBinario(poblacion)
        padre2 ← torneoBinario(poblacion)

        // ─── 2. CROSSOVER (OX con must-go garantizado) ───
        hijo ← cruzarOX(padre1, padre2)
        // Garantizar que todos los must-go estén en el giant tour del hijo

        // ─── 3. SPLIT ───
        hijo.enviosAsignados ← split(hijo.giantTour, grafo)
        hijo.enviosNoAsignados ← envios - hijo.enviosAsignados

        // ─── 4. BÚSQUEDA LOCAL ───
        hijo ← localSearchDelete(hijo)      // Remover opcionales problemáticos
        hijo ← localSearchAdd(hijo)          // Insertar no-asignados
        hijo ← localSearchSwapOut(hijo)      // Intercambiar dentro↔fuera
        hijo ← localSearchRelocate(hijo)     // Reubicar en giant tour
        hijo ← localSearchSwap(hijo)         // Intercambiar posiciones
        hijo ← localSearch2Opt(hijo)         // Invertir segmento

        // ─── 5. EVALUACIÓN ───
        calcularViolaciones(hijo)
        calcularFitness(hijo)
        hijo.esFactible ← (violCapacidad = 0 Y violTiempo = 0 Y mustGo asignados)

        // ─── 6. GESTIÓN DE POBLACIÓN ───
        SI hijo.esFactible:
            poblacion.factibles.agregar(hijo)
            SI hijo.fitness < mejorHistorico.fitness:
                mejorHistorico ← hijo
            SI factibles.tamaño > 25:
                eliminar peor de factibles
        SINO:
            poblacion.infactibles.agregar(hijo)
            SI infactibles.tamaño > 25:
                eliminar peor de infactibles

        // ─── 7. AJUSTE DE PENALIZACIONES (cada 100 iteraciones) ───
        SI iteracion MOD 100 = 0:
            ratio ← factibles.tamaño / poblacion.tamañoTotal
            SI ratio < 0.2:  // Muchas infactibles → aumentar penalizaciones
                penCap  ← penCap × 1.2
                penTime ← penTime × 1.2
            SI ratio > 0.8:  // Muchas factibles → reducir para explorar
                penCap  ← penCap × 0.85
                penTime ← penTime × 0.85

    // ─── RETORNO ───
    SI mejorHistorico ≠ null:
        RETORNAR mejorHistorico              // Mejor factible histórico
    SINO SI factibles NO vacío:
        RETORNAR min(factibles, por fitness) // Fallback factible
    SINO:
        RETORNAR min(infactibles, por fitness) // Menos mala infactible
```

---

## Operadores de Búsqueda Local (Detalle)

### DELETE — Remover envíos opcionales

```
FUNCIÓN localSearchDelete(individuo):
    mejor ← clonar(individuo)

    REPETIR:
        huboMejora ← false
        PARA CADA envio EN mejor.enviosAsignados DONDE NOT envio.esMustGo:
            prueba ← clonar(mejor)
            prueba.enviosAsignados.remover(envio)
            prueba.enviosNoAsignados.agregar(envio)

            SI fitness(prueba) < fitness(mejor):
                mejor ← prueba
                huboMejora ← true
                SALIR del FOR (first-improvement)

    HASTA huboMejora = false
    RETORNAR mejor
```

### ADD — Insertar envíos no asignados

```
FUNCIÓN localSearchAdd(individuo):
    mejor ← clonar(individuo)
    candidatos ← ordenar mejor.enviosNoAsignados por (mustGo DESC, prioridad DESC)

    REPETIR:
        huboMejora ← false
        PARA CADA envio EN candidatos:
            ruta ← split.asignarMejorRuta(envio)
            SI ruta = null: CONTINUAR

            prueba ← clonar(mejor)
            prueba.enviosAsignados[envio] = ruta
            prueba.enviosNoAsignados.remover(envio)

            SI fitness(prueba) < fitness(mejor) O envio.esMustGo:
                mejor ← prueba
                huboMejora ← true
                SALIR del FOR

    HASTA huboMejora = false
    RETORNAR mejor
```

### SWAP-OUT — Intercambiar dentro ↔ fuera

```
FUNCIÓN localSearchSwapOut(individuo):
    mejor ← clonar(individuo)

    PARA CADA eDentro EN mejor.enviosAsignados DONDE NOT eDentro.esMustGo:
        PARA CADA eFuera EN mejor.enviosNoAsignados:
            ruta ← split.asignarMejorRuta(eFuera)
            SI ruta = null: CONTINUAR

            prueba ← clonar(mejor)
            prueba.enviosAsignados.remover(eDentro)
            prueba.enviosAsignados[eFuera] = ruta
            prueba.enviosNoAsignados.agregar(eDentro)
            prueba.enviosNoAsignados.remover(eFuera)

            SI fitness(prueba) < fitness(mejor):
                RETORNAR prueba     ← first-improvement

    RETORNAR mejor
```

### SWAP, RELOCATE, 2-OPT — Operan sobre Giant Tour

```
FUNCIÓN localSearchSwap(individuo):
    tour ← individuo.giantTour
    PARA CADA par (i, j) EN tour:
        intercambiar tour[i] ↔ tour[j]
        re-ejecutar SPLIT
        SI fitness mejora: RETORNAR    ← first-improvement
        revertir intercambio

FUNCIÓN localSearchRelocate(individuo):
    tour ← individuo.giantTour
    PARA CADA i, j EN tour:
        mover tour[i] → posición j
        re-ejecutar SPLIT
        SI fitness mejora: RETORNAR

FUNCIÓN localSearch2Opt(individuo):
    tour ← individuo.giantTour
    PARA CADA segmento [i..j] EN tour:
        invertir tour[i..j]
        re-ejecutar SPLIT
        SI fitness mejora: RETORNAR
```

---

## Flujo por Épocas

```
FUNCIÓN simularPorEpocas(enviosTotales, duracionEpocaHoras):
    epocas ← organizarEnEpocas(enviosTotales, duracionEpocaHoras)
    pendientes ← lista vacía
    costoAcumulado ← 0

    PARA CADA epoca EN epocas:
        // Preparar: nuevos + pendientes de épocas anteriores
        enviosEpoca ← epoca.enviosNuevos + pendientes
        actualizarMustGo(enviosEpoca, epoca.momento)

        // Ejecutar DHGS
        solucion ← ejecutarDHGS(enviosEpoca, epoca.numero, epocas.total, 25, 10s)

        // Procesar resultado
        despachados ← solucion.enviosAsignados
        pendientes  ← solucion.enviosNoAsignados
        costoAcumulado += solucion.costoTotal

    RETORNAR costoAcumulado, historial de épocas
```

