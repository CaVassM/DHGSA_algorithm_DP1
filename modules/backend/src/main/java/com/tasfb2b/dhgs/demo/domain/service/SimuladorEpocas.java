package com.tasfb2b.dhgs.demo.domain.service;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.AlmacenEstado;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Servicio que gestiona la simulación por épocas.
 *
 * Flujo:
 * 1. Cargar datos (aeropuertos, vuelos, envíos)
 * 2. Organizar envíos en épocas temporales
 * 3. Para cada época: preparar datos → ejecutar DHGS → procesar resultado
 * 4. Acumular métricas y generar reporte final
 */
@Service
public class SimuladorEpocas {

    // Solo para debug
    private static final Logger log = LoggerFactory.getLogger(SimuladorEpocas.class);
    // Constante que define que cada epoca dura 4h.
    // Simulacion divide el tiempo total en ventnas de 4 horas (epocas)
    // En cada ventana, DHGS toma todos los envios disponibles y optmiza rutas
    // Ahora, es en 4h pq es el parametro del paper DHGS (cotejar). La idea es que cada cierto tiempo
    // se re optimiza con inforamcion nueva (envios que llegan), simulando una operacion logistica dinamica.
    private static final long DURACION_EPOCA_HORAS = 4;

    // Historial es la memoria completa de la simulacion. Guarda una lista de objetos EpocaData.
    // En cada uno contiene enviosNuevos, enviosPendientes, enviosDespachados, enviosPostpuestos, estadoAlmacenes, costoEpoca.
    private List<EpocaData> historial;

    // Es el estado vivo de todos los almacenes de los aeropuertos a lo largo de la simulación.
    // Se actualiza epoca a epoca.
    private Map<String, AlmacenEstado> estadoGlobalAlmacenes;

    // Costo acumulado es la suma de costos de todas las epocas ejecutadas hasta ahora.
    // Se actualiza en finalizarEpoca()
    private double costoAcumulado;

    // Constructor.
    public SimuladorEpocas() {
        this.historial = new ArrayList<>();
        this.estadoGlobalAlmacenes = new HashMap<>();
        this.costoAcumulado = 0.0;
    }

    // --- Getters ---
    public List<EpocaData> getHistorial() { return historial; }
    public double getCostoAcumulado() { return costoAcumulado; }
    public Map<String, AlmacenEstado> getEstadoGlobalAlmacenes() { return estadoGlobalAlmacenes; }

    /**
     * Organiza los envíos en épocas basándose en su fecha/hora de creación.
     *
     * @param envios          todos los envíos cargados
     * @param aeropuertos     lista de aeropuertos (para inicializar almacenes)
     * @param fechaInicio     fecha/hora de inicio de la simulación
     * @param duracionEpocaHoras duración de cada época en horas
     * @return lista de épocas organizadas
     */
    public List<EpocaData> organizarEnEpocas(List<Envio> envios, List<Aeropuerto> aeropuertos,
                                             LocalDateTime fechaInicio, long duracionEpocaHoras) {
        return organizarEnEpocas(envios, aeropuertos, fechaInicio, duracionEpocaHoras, 5);
    }

    public List<EpocaData> organizarEnEpocas(List<Envio> envios, List<Aeropuerto> aeropuertos,
                                             LocalDateTime fechaInicio, long duracionEpocaHoras,
                                             long duracionSimulacionDias) {
        this.historial.clear();
        this.costoAcumulado = 0.0;

        // Si no hay envios o esta vacio, retorna el historial. Es l lista de epocas organizadas.
        if (envios == null || envios.isEmpty()) return historial;

        // Inicializar almacenes
        inicializarAlmacenes(aeropuertos);

        // Ordenar envíos por fecha de creación. Sistema dependiente del tiempo
        // Luego ya se procede con colocar por ventanas temporales.
        // Que interesante, en Java devuelve un collector, pero se puede crear a list.
        List<Envio> ordenados = envios.stream()
                .sorted(Comparator.comparing(Envio::getFechaHoraCreacion))
                .collect(Collectors.toList());

        // Determinar rango temporal. El primer y ultimo envio proviene de todo el listado mandado.
        LocalDateTime primerEnvio = ordenados.get(0).getFechaHoraCreacion();

        // La simulación debe recorrer una línea de tiempo explícita.
        // Si no se especifica fecha de inicio, comienza al inicio del día anterior
        // al primer envío cargado.
        LocalDateTime inicioEpoca = resolverFechaInicio(fechaInicio, primerEnvio);
        // 4 horas segun el paper.
        Duration duracion = Duration.ofHours(duracionEpocaHoras); // El otro estatico al parecer no se usa, bueno va bien al parecer.
        LocalDateTime finSimulacion = inicioEpoca.plusDays(Math.max(1, duracionSimulacionDias));

        boolean mantenerEpocasVacias = true;

        int numeroEpoca = 1;
        LocalDateTime finEpoca = inicioEpoca.plus(duracion); // Va ta bien.

        // Mientras el inicio
        // InicioEpoca y el FinEpoca son ambos LocalDateTime
        // Creo que es una manera de recorrer todos los envios, no es asi?
        while (inicioEpoca.isBefore(finSimulacion)) {
            final LocalDateTime inicioFinal = inicioEpoca;
            final LocalDateTime finFinal = finEpoca;

            // Filtrar envíos que pertenecen a esta época
            List<Envio> enviosEpoca = ordenados.stream()
                    .filter(e -> !e.getFechaHoraCreacion().isBefore(inicioFinal)
                              && e.getFechaHoraCreacion().isBefore(finFinal))
                    .collect(Collectors.toList());

            if (mantenerEpocasVacias || !enviosEpoca.isEmpty() || numeroEpoca == 1) {
                EpocaData epoca = new EpocaData(numeroEpoca, inicioEpoca, finEpoca);
                epoca.setEnviosNuevos(enviosEpoca);
                historial.add(epoca);
                numeroEpoca++;
            }

            inicioEpoca = finEpoca; // Va recorriendo una ventana temporal
            finEpoca = inicioEpoca.plus(duracion); // +4h
        }

        long enviosFueraDeVentana = ordenados.stream()
                .filter(e -> e.getFechaHoraCreacion().isBefore(historial.get(0).getInicio())
                        || !e.getFechaHoraCreacion().isBefore(finSimulacion))
                .count();

        log.info("Organizados {} envíos en {} épocas (duración: {}h, inicio simulación: {}, fin simulación: {}, fuera de ventana: {})",
                envios.size(), historial.size(), duracionEpocaHoras,
                historial.isEmpty() ? inicioEpoca : historial.get(0).getInicio(),
                finSimulacion, enviosFueraDeVentana);

        return historial;
    }

    private LocalDateTime resolverFechaInicio(LocalDateTime fechaInicioSolicitada, LocalDateTime primerEnvio) {
        LocalDateTime inicioPorDefecto = primerEnvio.toLocalDate().minusDays(1).atStartOfDay();

        if (fechaInicioSolicitada == null) {
            return inicioPorDefecto;
        }

        // Nunca arrancar después del primer envío, para no dejar envíos fuera de la línea de tiempo.
        return fechaInicioSolicitada.isAfter(primerEnvio)
                ? primerEnvio.toLocalDate().atStartOfDay()
                : fechaInicioSolicitada;
    }

    // Supongo se itera el historial para utilizarlo, o algo que recorra las epocas generadas por todos los envios.
    /**
     * Prepara una época para ser procesada por el algoritmo DHGS.
     * Actualiza must-go y pendientes de épocas anteriores.
     *
     * @param epocaActual la época a preparar
     * @param pendientes  envíos no despachados de la época anterior
     */
    public void prepararEpoca(EpocaData epocaActual, List<Envio> pendientes) {
        // Agregar pendientes de épocas anteriores
        if (pendientes != null && !pendientes.isEmpty()) {
            epocaActual.setEnviosPendientes(new ArrayList<>(pendientes));
        }

        registrarLlegadasEnAlmacenes(epocaActual.getEnviosNuevos(), epocaActual.getInicio());

        // Actualizar must-go de todos los envíos según el momento actual
        // Y ese margenHoras? ahh es el margen que tiene que verificar con el deadline para asi determinar si debe de ir a la epoca actual.
        LocalDateTime momentoEpoca = epocaActual.getInicio();
        // El getTodosLosEnvios manda pendientes y nuevos de una epoca.
        for (Envio e : epocaActual.getTodosLosEnvios()) {
            e.actualizarMustGo(momentoEpoca, 8);
            e.calcularPrioridad(momentoEpoca);
        }

        // En la epoca ya esta actualizado los envios actuales, los pendientes tambien para colocarlos.
        // Adicioanlmetne se ha valculado de todos los envios aquellos que requeren enviarse criticamene en esa epoca
        // tambien se calculn prioridad.
        log.info("Época {} preparada: {} nuevos, {} pendientes, {} must-go",
                epocaActual.getNumeroEpoca(),
                epocaActual.getEnviosNuevos().size(),
                epocaActual.getEnviosPendientes().size(),
                epocaActual.contarMustGo());
    }

    /**
     * Finaliza una época procesando el resultado del algoritmo DHGS.
     * Separa envíos despachados de los que se postponen.
     *
     * @param epocaActual la época que finalizó
     * @param solucion    mejor solución encontrada por DHGS
     * @return lista de envíos postponidos (para la siguiente época)
     */
    // Entonces este es solo una funcion de procesamiento?
    public List<Envio> finalizarEpoca(EpocaData epocaActual, Individuo solucion) {
        List<Envio> postponidos = new ArrayList<>();

        if (solucion == null) {
            // Sin solución: todos los envíos se postponen
            postponidos.addAll(epocaActual.getTodosLosEnvios());
            epocaActual.setEnviosPostpuestos(postponidos); // Para luego mandarse a la otra funcion de preparaEpoca.
            epocaActual.setProcesada(true);
            return postponidos;
        }

        // A ver, hay solucion dice en esa epoca.
        // Envíos despachados = los asignados en la solución
        List<Envio> despachados = new ArrayList<>(solucion.getEnviosAsignados().keySet());
        epocaActual.setEnviosDespachados(despachados);

        // Envíos postponidos = los no asignados
        postponidos.addAll(solucion.getEnviosNoAsignados());
        epocaActual.setEnviosPostpuestos(postponidos);

        // Calcular costo de esta época
        double costoEpoca = solucion.calcularCostoTotal();
        epocaActual.setCostoEpoca(costoEpoca);
        this.costoAcumulado += costoEpoca;

        // Actualizar estados de almacenes
        actualizarAlmacenes(solucion);

        // Copiar estado actual de almacenes a la época
        Map<String, AlmacenEstado> snapshot = new HashMap<>();
        for (Map.Entry<String, AlmacenEstado> entry : estadoGlobalAlmacenes.entrySet()) {
            AlmacenEstado estado = new AlmacenEstado();
            estado.setAeropuerto(entry.getValue().getAeropuerto());
            estado.setMaletasActuales(entry.getValue().getMaletasActuales());
            estado.setMomentoTiempo(epocaActual.getFin());
            estado.setEnviosPendientes(entry.getValue().getEnviosPendientes() == null
                    ? new ArrayList<>()
                    : new ArrayList<>(entry.getValue().getEnviosPendientes()));
            snapshot.put(entry.getKey(), estado);
        }
        epocaActual.setEstadoAlmacenes(snapshot);
        epocaActual.setProcesada(true);

        log.info("Época {} finalizada: {} despachados, {} postponidos, costo={}",
                epocaActual.getNumeroEpoca(), despachados.size(),
                postponidos.size(), String.format("%.2f", costoEpoca));

        return postponidos;
    }

    /**
     * Obtiene los datos de una época específica por número.
     */
    public EpocaData obtenerEpoca(int numero) {
        return historial.stream()
                .filter(e -> e.getNumeroEpoca() == numero)
                .findFirst()
                .orElse(null);
    }

    /**
     * Retorna el total de épocas configuradas.
     */
    public int getTotalEpocas() {
        return historial.size();
    }

    // --- Métodos privados ---
    // Vale aqui se carga con la data que se tiene por el profesor.
    private void inicializarAlmacenes(List<Aeropuerto> aeropuertos) {
        // Se coloca como clear en caso se haya cargado antes.
        estadoGlobalAlmacenes.clear();
        if (aeropuertos == null) return;

        for (Aeropuerto a : aeropuertos) {
            AlmacenEstado estado = new AlmacenEstado();
            estado.setAeropuerto(a);
            estado.setMaletasActuales(0);
            estadoGlobalAlmacenes.put(a.getCodigoICAO(), estado);
        }
    }

    private void actualizarAlmacenes(Individuo solucion) {
        // No tiene sentido si no hay solucion o no cuenta con envios asigndos.
        if (solucion == null || solucion.getEnviosAsignados() == null) return;

        // Esa solucion se aplica, asi que se despacha.
        for (Map.Entry<Envio, RutaEnvio> entry : solucion.getEnviosAsignados().entrySet()) {
            Envio envio = entry.getKey();
            // Al despachar un envío, se remueven maletas del almacén origen
            String origenICAO = envio.getAeropuertoOrigen().getCodigoICAO();
            AlmacenEstado almacenOrigen = estadoGlobalAlmacenes.get(origenICAO);
            if (almacenOrigen != null) {
                almacenOrigen.removerEnvio(envio);
            }

            if (entry.getValue() != null && entry.getValue().getSecuenciaVuelos() != null) {
                entry.getValue().getSecuenciaVuelos().forEach(vuelo -> {
                    boolean reservado = vuelo.registrarAsignacion(envio.getCantidadMaletas());
                    if (!reservado) {
                        log.warn("No se pudo reservar capacidad residual en vuelo {} para envío {}",
                                vuelo.getId(), envio.getId());
                    }
                });
            }
        }
    }

    private void registrarLlegadasEnAlmacenes(List<Envio> enviosNuevos, LocalDateTime momento) {
        if (enviosNuevos == null || enviosNuevos.isEmpty()) {
            return;
        }

        for (Envio envio : enviosNuevos) {
            if (envio == null || envio.getAeropuertoOrigen() == null) {
                continue;
            }

            String icao = envio.getAeropuertoOrigen().getCodigoICAO();
            AlmacenEstado almacen = estadoGlobalAlmacenes.get(icao);
            if (almacen == null) {
                almacen = new AlmacenEstado();
                almacen.setAeropuerto(envio.getAeropuertoOrigen());
                estadoGlobalAlmacenes.put(icao, almacen);
            }

            almacen.setMomentoTiempo(momento);
            boolean yaRegistrado = almacen.getEnviosPendientes() != null
                    && almacen.getEnviosPendientes().contains(envio);
            if (!yaRegistrado) {
                almacen.agregarEnvio(envio);
            }
        }
    }
}

