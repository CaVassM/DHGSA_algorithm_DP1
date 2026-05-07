# Pseudocódigo — DHGS e IALNS con vuelos recurrentes materializados

## Entrada conceptual

```text
ENTRADA:
  aeropuertos[]            ← lista de aeropuertos
  vuelosPlantilla[]        ← vuelos recurrentes base
  enviosTotales[]          ← envíos con fechaHoraCreacion y deadline
  fechaInicioSimulacion    ← explícita o derivada del primer envío
  duracionSimulacionDias   ← configurable (3, 5 o 7 en la suite de referencia)
  duracionEpocaHoras       ← parámetro configurable (4 en la suite de referencia)
  tamanoPoblacion          ← parámetro DHGS configurable
  limiteTiempoPorEpoca     ← parámetro DHGS configurable
```

## Configuración de referencia vigente

```text
test-experiment.properties actual:
  start = 2026-07-14T00:00:00
  3 días → 8578 envíos / 14927 maletas
  5 días → 14162 envíos / 25013 maletas
  7 días → 19547 envíos / 35183 maletas

Ventana de estrés conocida en análisis offline:
  start = 2029-01-01T00:00:00
  5 días → 91210 envíos / 174007 maletas
```

## Salida conceptual

```text
SALIDA:
  historialEpocas[]
  mejorSolucionPorEpoca
  costoTotal
  enviosDespachados
  enviosPostpuestos
```

---

## Fase 0 — Construcción del horizonte de simulación

```text
FUNCIÓN prepararHorizonte(enviosTotales, fechaInicioSimulacion, duracionSimulacionDias):
    SI fechaInicioSimulacion es null:
        fechaInicio ← inicio del día anterior al primer envío
    SINO:
        fechaInicio ← fechaInicioSimulacion

    fechaFin ← fechaInicio + duracionSimulacionDias días

    RETORNAR [fechaInicio, fechaFin)
```

---

## Fase 1 — Generación de épocas

```text
FUNCIÓN organizarEnEpocas(enviosTotales, fechaInicio, duracionEpocaHoras=4, dias):
    historial ← []
    finSimulacion ← fechaInicio + dias días
    inicioEpoca ← fechaInicio
    numeroEpoca ← 1

    MIENTRAS inicioEpoca < finSimulacion:
        finEpoca ← inicioEpoca + 4 horas

        enviosNuevos ← filtrar enviosTotales tales que:
            envio.fechaHoraCreacion ∈ [inicioEpoca, finEpoca)

        epoca ← nueva EpocaData(numeroEpoca, inicioEpoca, finEpoca)
        epoca.enviosNuevos ← enviosNuevos
        historial.agregar(epoca)

        inicioEpoca ← finEpoca
        numeroEpoca++

    RETORNAR historial    ← (dias × 24 / duracionEpocaHoras) épocas
```

---

## Fase 2 — Materialización de vuelos diarios

```text
FUNCIÓN materializarVuelos(vuelosPlantilla, fechaInicio, dias):
    instancias ← []

    PARA CADA vuelo EN vuelosPlantilla:
        PARA offset DESDE 0 HASTA dias - 1:
            fechaOperacion ← fechaInicio + offset días

            instancia ← nueva InstanciaVuelo
            instancia.idPlantilla ← vuelo.id
            instancia.id ← vuelo.id + "@" + fechaOperacion
            instancia.fechaOperacion ← fechaOperacion
            instancia.origen ← vuelo.origen
            instancia.destino ← vuelo.destino
            instancia.capacidad ← vuelo.capacidad
            instancia.capacidadDisponible ← vuelo.capacidad
            instancia.fechaHoraSalida ← combinar(fechaOperacion, vuelo.horaSalida)
            instancia.fechaHoraLlegada ← instancia.fechaHoraSalida + vuelo.duracion

            instancias.agregar(instancia)

    RETORNAR instancias
```

---

## Fase 3 — Construcción del grafo operativo

```text
FUNCIÓN construirGrafo(aeropuertos, vuelosPlantilla, fechaInicio, dias):
    vuelosInstanciados ← materializarVuelos(vuelosPlantilla, fechaInicio, dias)

    grafo.nodos ← aeropuertos
    grafo.arcos ← vuelosInstanciados

    PARA CADA aeropuerto:
        registrar lista de salidas

    PARA CADA instanciaVuelo:
        agregar a adyacencia[instanciaVuelo.origen]

    ordenar las salidas por fechaHoraSalida

    RETORNAR grafo
```

---

## Fase 4 — Preparación de una época

```text
FUNCIÓN prepararEpoca(epoca, pendientes):
    epoca.enviosPendientes ← pendientes
    enviosDisponibles ← epoca.enviosNuevos + epoca.enviosPendientes

    PARA CADA envio EN enviosDisponibles:
        envio.actualizarMustGo(epoca.inicio, margenHoras=8)
        envio.calcularPrioridad(epoca.inicio)

    RETORNAR enviosDisponibles
```

---

## Fase 5 — SPLIT con rutas temporales

```text
FUNCIÓN asignarMejorRuta(envio, grafo):
    rutaVuelos ← dijkstraTemporal(
        origen = envio.origen,
        destino = envio.destino,
        carga = envio.maletas,
        salidaMinima = envio.fechaHoraCreacion
    )

    SI rutaVuelos está vacía:
        RETORNAR null

    ruta ← nueva RutaEnvio
    ruta.envio ← envio
    ruta.secuenciaVuelos ← rutaVuelos
    ruta.calcularTiempos()

    RETORNAR ruta
```

### Nota importante sobre el `GiantTour` actual

```text
En la versión vigente:
  split(giantTour) procesa cada envío del giantTour de forma independiente.

Entonces:
  - el conjunto de envíos sí importa
  - el orden del giantTour todavía no cambia la ruta elegida para un envío

Conclusión:
  hoy DHGS optimiza principalmente qué envíos entran o salen de la solución,
  no la secuencia interna del tour como en un HGS de ruteo clásico.
```

### Dijkstra temporal simplificado

```text
FUNCIÓN dijkstraTemporal(origen, destino, carga, salidaMinima):
    llegadaMasTemprana[origen] ← salidaMinima
    cola ← prioridad por fechaHora

    insertar (origen, salidaMinima)

    MIENTRAS cola no esté vacía:
        actual ← extraer menor fechaHora

        SI actual.aeropuerto = destino:
            reconstruir ruta y RETORNAR

        PARA CADA vueloInstancia saliendo de actual.aeropuerto:
            SI vueloInstancia.capacidadDisponible < carga:
                CONTINUAR

            SI vueloInstancia.fechaHoraSalida < actual.fechaHora:
                CONTINUAR

            vecino ← vueloInstancia.destino
            llegada ← vueloInstancia.fechaHoraLlegada

            SI llegada < llegadaMasTemprana[vecino]:
                actualizar predecesor
                llegadaMasTemprana[vecino] ← llegada
                insertar (vecino, llegada)

    RETORNAR []
```

---

## Fase 6 — Población inicial DHGS

```text
FUNCIÓN generarPoblacionInicial(enviosDisponibles, tamanoPoblacion):
    poblacion ← []

    greedy ← ordenar enviosDisponibles por prioridad descendente
    poblacion.agregar(solucionGreedy(greedy))

    mustGo ← filtrar enviosDisponibles donde esMustGo = true
    poblacion.agregar(solucionLazy(mustGo))

    probabilidades ← [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]

    MIENTRAS poblacion.tamaño < tamanoPoblacion:
        generar subconjunto aleatorio preservando mustGo
        permutar subconjunto
        poblacion.agregar(solucionAleatoria)

    RETORNAR poblacion
```

---

## Fase 7 — Loop principal DHGS

```text
FUNCIÓN ejecutarDHGS(enviosDisponibles, epocaActual, totalEpocas, tamanoPoblacion, limiteTiempo):
    poblacion ← generarPoblacionInicial(enviosDisponibles, tamanoPoblacion)
    inicio ← relojActual()
    iteracion ← 0
    mejorFitness ← obtenerMejorFitness(poblacion)
    fitnessReferenciaVentana ← mejorFitness
    iteracionesEnVentana ← 0

    MIENTRAS relojActual() - inicio < limiteTiempo:
        iteracion++
        iteracionesEnVentana++

        SI debeDiversificarPorEstancamiento(iteracion,
                                            iteracionesEnVentana,
                                            mejoraRelativa(fitnessReferenciaVentana, mejorFitness),
                                            poblacion):
            diversificarPoblacion(enviosDisponibles, epocaActual, totalEpocas, tamanoPoblacion)
            mejorFitness ← obtenerMejorFitness(poblacion)
            fitnessReferenciaVentana ← mejorFitness
            iteracionesEnVentana ← 0
            CONTINUAR

        padres ← seleccionarPadres(poblacion)
        hijo ← crossoverOX(padres)

        hijo.enviosAsignados ← split(hijo.representacionGigante)
        hijo.enviosNoAsignados ← enviosDisponibles - hijo.enviosAsignados

        hijo ← localSearchDelete(hijo)
        hijo ← localSearchAdd(hijo)
        hijo ← localSearchSwapOut(hijo)

        calcularViolaciones(hijo)
        calcularFitness(hijo)
        hijo.validarFactibilidad()

        poblacion.agregar(hijo)

        SI no esEstrictamenteFactible(hijo, validador):
            reparado ← repararHaciaFactibilidad(hijo)
            SI reparado difiere de hijo:
                poblacion.agregar(reparado)

        mejorFitnessActual ← obtenerMejorFitness(poblacion)
        SI mejorFitnessActual mejora a mejorFitness:
            mejorFitness ← mejorFitnessActual

        SI iteracion MOD 100 = 0:
            ajustarPenalizaciones(poblacion.ratioFactibles)

    candidatos ← todos los individuos de la población + mejorHistorico si existe
    RETORNAR seleccionarMejorRetorno(candidatos)
```

### Reparación hacia factibilidad estricta en DHGS

```text
FUNCIÓN repararHaciaFactibilidad(individuo):
    reparado ← clonar(individuo)
    evaluar(reparado)
    violaciones ← validarIndividuo(reparado)

    MIENTRAS violaciones no estén vacías:
        candidato ← seleccionar envío opcional asignado que más contribuya al conflicto
        SI candidato no existe:
            ROMPER

        remover candidato de enviosAsignados
        agregar candidato a enviosNoAsignados
        remover candidato de representacionGigante
        evaluar(reparado)
        violaciones ← validarIndividuo(reparado)

    RETORNAR reparado
```

### Selección final de retorno en DHGS

```text
FUNCIÓN seleccionarMejorRetorno(candidatos):
    priorizar primero individuos estrictamente factibles
    desempatar por fitness ascendente
    RETORNAR el mejor
```

---

## Fase 8 — Fitness operativo actual

```text
FUNCIÓN calcularFitness(individuo):
    distanciaTotal ← Σ ruta.costo
    violCapacidad ← Σ excesoCapacidad²
    violTiempo ← Σ retraso²
    violAlmacen ← Σ excesoAlmacen²
    penNoAsignados ← penalización por envíos no asignados

    fitness ← distanciaTotal
             + penCapacidad × violCapacidad
             + penTiempo × violTiempo
             + penCapacidad × violAlmacen
             + penNoAsignados

    RETORNAR fitness
```

### Cómo se forman `violCapacidad` y `violAlmacen`

```text
violCapacidad:
    PARA CADA vuelo usado por la solución:
        cargaVuelo ← suma de maletas de todos los envíos que usan ese vuelo
        exceso ← max(0, cargaVuelo - capacidadDisponibleVuelo)
        acumular exceso²

violAlmacen:
    PARA CADA aeropuerto origen con envíos no asignados:
        cargaAlmacen ← suma de maletas de los envíos no asignados en ese aeropuerto
        exceso ← max(0, cargaAlmacen - capacidadAlmacenAeropuerto)
        acumular exceso²
```

---

## Fase 9 — Flujo completo de simulación

```text
FUNCIÓN ejecutarSimulacionCompleta(aeropuertos, vuelosPlantilla, enviosTotales,
                                  fechaInicioSimulacion,
                                  duracionSimulacionDias,
                                  duracionEpocaHoras,
                                  tamanoPoblacion,
                                  limiteTiempo):
    [fechaInicio, fechaFin] ← prepararHorizonte(enviosTotales, fechaInicioSimulacion, duracionSimulacionDias)
    epocas ← organizarEnEpocas(enviosTotales, fechaInicio, duracionEpocaHoras, duracionSimulacionDias)
    grafo ← construirGrafo(aeropuertos, vuelosPlantilla, fechaInicio, duracionSimulacionDias)
    pendientes ← []

    PARA CADA epoca EN epocas:
        enviosDisponibles ← prepararEpoca(epoca, pendientes)

        SI enviosDisponibles está vacío:
            CONTINUAR

        mejor ← ejecutarDHGS(enviosDisponibles,
                             epoca.numero,
                             epocas.tamaño,
                             tamanoPoblacion,
                             limiteTiempo)

        despachados ← mejor.enviosAsignados
        pendientes ← mejor.enviosNoAsignados
        registrar resultado en epoca
        actualizar almacenes

    RETORNAR historial completo
```

---

## Fase 10 — IALNS sobre el mismo dominio operativo

```text
FUNCIÓN ejecutarIALNS(enviosDisponibles, epocaActual, totalEpocas, tamanoPoblacion, limiteTiempo):
    SI enviosDisponibles está vacío:
        RETORNAR individuo vacío factible

    ctx ← nuevo IALNSContext(split, fitness, validador, epocaActual, totalEpocas)
    solucionInicial ← construirSolucionInicial(enviosDisponibles, epocaActual, totalEpocas, tamanoPoblacion, ctx)

    estado ← nuevo IALNSState(cantidadOperadoresDestroy, cantidadOperadoresRepair)
    estado.reset(solucionInicial)
    randomDestroy.factorQ ← estado.factorQ

    iteracionesSinMejora ← 0
    mejorasConsecutivas ← 0
    inicio ← relojActual()

    MIENTRAS estado.temperaturaActiva() Y relojActual() - inicio < limiteTiempo:
        estado.iteracion++

        indiceDestroy ← estado.seleccionarDestruccion()
        indiceRepair ← estado.seleccionarReparacion()

        destruccion ← operadorDestroy[indiceDestroy].destruir(estado.actual)
        nueva ← operadorRepair[indiceRepair].reparar(destruccion.solucionDestruida,
                                                     destruccion.enviosRemovidos,
                                                     ctx)
        evaluar(nueva)

        actualizarScoreDestruccion(indiceDestroy, nueva)
        actualizarScoreReparacion(indiceRepair, nueva)

        SI nueva mejora a mejorGlobal:
            mejorGlobal ← clonar(nueva)
            mejorasConsecutivas++
            iteracionesSinMejora ← 0
        SINO:
            iteracionesSinMejora++
            mejorasConsecutivas ← 0

        SI criterioAceptacion(estado.actual, nueva, temperatura):
            estado.actual ← clonar(nueva)

        SI iteracion MOD UPDATE_INTERVAL = 0:
            actualizarPesos(ALPHA)
            ajustarFactorQ(según mejora reciente)

        enfriarTemperatura()

    RETORNAR clonar(mejorGlobal)
```

### Construcción de solución inicial en IALNS

```text
FUNCIÓN construirSolucionInicial(envios, epocaActual, totalEpocas, tamanoPoblacion, ctx):
    candidatos ← generarPoblacionInicial(envios, max(3, tamanoPoblacion))

    SI candidatos está vacío:
        candidatos ← [solucionGreedy(envios)]

    PARA CADA candidato EN candidatos:
        normalizarCoberturaCompleta(candidato, envios)
        evaluar(candidato)

    RETORNAR candidato con prioridad:
        1) factible
        2) menor fitness
```

### Observación importante sobre IALNS

```text
IALNS no usa población separada en factibles / infactibles como DHGS,
pero sí comparte el mismo CalculadorFitness y el mismo Validador.

La normalización de cobertura completa fuerza que el giant tour mantenga todos
los envíos conocidos de la época, y luego la reparación decide cuáles quedan
realmente asignados o no asignados.
```

---

## Restricciones activas y fuera de alcance

### Activas
- capacidad de vuelo
- deadline del envío
- continuidad temporal de conexiones
- ocupación de almacenes
- penalización por no asignados

### Precisión importante

- la capacidad de vuelo agregada se penaliza a nivel del individuo completo
- la ocupación de almacén se mide por maletas que quedan sin asignar en el aeropuerto origen
- el reordenamiento puro del giant tour no está activo como fuente de mejora mientras `SPLIT` siga siendo independiente del orden

### Fuera de alcance en esta versión
- cancelaciones de vuelos
- replanificación por disrupciones
- estados operativos dinámicos durante la época

---

## Escenarios de prueba actuales

Las suites pesadas de experimento quedaron separadas del `mvn test` normal mediante `slow-experiment` y modelan:

1. **DHGS con ventana real de 3 días**
2. **DHGS con ventana real de 5 días**
3. **DHGS con ventana real de 7 días**
4. **IALNS con ventana real de 3 días**
5. **IALNS con ventana real de 5 días**
6. **IALNS con ventana real de 7 días**

La fecha de inicio, la duración, el tamaño de población, el límite por época y los conteos esperados se leen desde `src/test/resources/test-experiment.properties`.
