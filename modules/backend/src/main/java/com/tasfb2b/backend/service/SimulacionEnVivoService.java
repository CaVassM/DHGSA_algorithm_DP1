package com.tasfb2b.backend.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.tasfb2b.backend.domain.enums.DataSetReference;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.domain.enums.PlanningRunStatus;
import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.domain.model.PlanningRunEntity;
import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.backend.dto.request.LiveSimulationRequest;
import com.tasfb2b.backend.dto.response.CollapseReportResponse;
import com.tasfb2b.backend.dto.response.SimulationEventResponse;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
import com.tasfb2b.backend.repository.PlanningRunRepository;
import com.tasfb2b.backend.repository.ShipmentRepository;
import com.tasfb2b.dhgs.demo.algorithm.dhgs.DHGSAlgorithm;
import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSAlgorithm;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
import com.tasfb2b.dhgs.demo.application.dto.RutaDTO;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.AlmacenEstado;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.domain.service.EpocaData;
import com.tasfb2b.dhgs.demo.domain.service.SimuladorEpocas;
import com.tasfb2b.backend.service.PlanningRoutePersistenceService;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import lombok.RequiredArgsConstructor;

import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Simulación de periodo EN VIVO (escenario PERIOD_SIMULATION) con "salto de
 * algoritmo".
 *
 * En vez de correr todas las épocas de un tirón, las procesa una a una contra
 * un reloj: por cada época terminada emite su estado por WebSocket
 * ({@code /topic/simulacion/{runId}}) y luego espera el tiempo real que
 * corresponde según el multiplicador temporal antes de avanzar. Así el mapa
 * anima el avance de la semana de forma fluida.
 *
 * Salto de consumo: cada época cubre {@code epochHours} de tiempo simulado; en
 * tiempo real eso debe durar {@code epochHours*3600 / multiplicadorTemporal}
 * segundos. Ej.: época de 4h con multiplicador 240 → 60 s reales.
 *
 * El algoritmo (DHGS/IALNS) por época NO se modifica: este servicio lo envuelve.
 */
@Service
@RequiredArgsConstructor
public class SimulacionEnVivoService {

    private static final Logger log = LoggerFactory.getLogger(SimulacionEnVivoService.class);
    private final AirportRepository airportRepository;
    private final FlightRepository flightRepository;
    private final ShipmentRepository shipmentRepository;
    private final PlanningRunRepository planningRunRepository;
    private final SimuladorEpocas simuladorEpocas;
    private final GrafoVuelos grafoVuelos;
    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;
    private final SimpMessagingTemplate messaging;
    private final PlanningRoutePersistenceService planningRoutePersistenceService;

//    private final AirportRepository airportRepository;
//    private final FlightRepository flightRepository;
//    private final ShipmentRepository shipmentRepository;
//    private final SimuladorEpocas simuladorEpocas;
//    private final GrafoVuelos grafoVuelos;
//    private final ConstructorSolucionesIniciales constructorSoluciones;
//    private final AlgoritmoSPLIT split;
//    private final CalculadorFitness calculadorFitness;
//    private final Validador validador;
//    private final SimpMessagingTemplate messaging;

    /** Banderas de cancelación por runId (permite detener una simulación viva). */
    private final Map<Long, AtomicBoolean> cancelaciones = new ConcurrentHashMap<>();

    /**
     * Serializa las simulaciones: SimuladorEpocas y GrafoVuelos son beans
     * singleton con estado mutable compartido. Dos simulaciones a la vez se
     * corromperían entre sí (p.ej. organizarEnEpocas hace historial.clear()).
     * El lock garantiza una simulación a la vez; las demás esperan su turno.
     */
    private final ReentrantLock simulacionLock = new ReentrantLock();

    /** Parámetros de una corrida en vivo. */
    public record LiveParams(
            OptimizationAlgorithm algoritmo,
            LocalDateTime fechaInicio,
            long epochHours,
            long horizonDays,
            int populationSize,
            int timeLimitSeconds,
            int multiplicadorTemporal,
            boolean preBuffer,
            // --- Colapso (COLLAPSE_SIMULATION) ---
            boolean modoColapso,
            int factorCarga,          // multiplica la carga original (x2, x5, x10...)
            double umbralColapso      // % de envíos sin atender que define el colapso (0-100)
    ) {}
    
    @Transactional
    public Long registrarSimulacionEnVivo(LiveSimulationRequest request, boolean modoColapso) {
        PlannerAlgorithm plannerAlgorithm = resolverPlannerAlgorithm(request.getAlgorithm());

        PlanningRunEntity run = planningRunRepository.save(
                PlanningRunEntity.builder()
                        .algorithm(plannerAlgorithm)
                        .scenario(modoColapso
                            ? OperationalScenario.COLLAPSE_SIMULATION
                            : OperationalScenario.REAL_TIME)
                        .status(PlanningRunStatus.RUNNING)
                        .dataSetReference(DataSetReference.DB.name())
                        .startedAt(LocalDateTime.now())
                        .mensaje(modoColapso
                                ? "Simulación de colapso iniciada."
                                : "Simulación en vivo iniciada.")
                        .build()
        );

        return run.getId();
    }
    
    public LiveParams construirLiveParams(LiveSimulationRequest request, boolean modoColapso) {
    OptimizationAlgorithm algoritmo = resolverOptimizationAlgorithm(request.getAlgorithm());

    return new LiveParams(
            algoritmo,
            request.getPlanningStart(),
            request.getEpochHours(),
            request.getHorizonDays(),
            request.getPopulationSize(),
            request.getTimeLimitSeconds(),
            request.getMultiplicadorTemporal(),
            request.isPreBuffer(),
            modoColapso,
            modoColapso ? Math.max(1, request.getFactorCarga()) : 1,
            modoColapso ? request.getUmbralColapso() : 100.0
    );
}

private PlannerAlgorithm resolverPlannerAlgorithm(String rawAlgorithm) {
    if ("IALNS".equalsIgnoreCase(rawAlgorithm)
            || "IALNS_SA".equalsIgnoreCase(rawAlgorithm)) {
        return PlannerAlgorithm.IALNS_SA;
    }

    return PlannerAlgorithm.DHGS;
}

private OptimizationAlgorithm resolverOptimizationAlgorithm(String rawAlgorithm) {
    if ("IALNS".equalsIgnoreCase(rawAlgorithm)
            || "IALNS_SA".equalsIgnoreCase(rawAlgorithm)) {
        return OptimizationAlgorithm.IALNS;
    }

    return OptimizationAlgorithm.DHGS;
}
    
    public void cancelar(Long runId) {
        AtomicBoolean flag = cancelaciones.get(runId);
        if (flag != null) flag.set(true);
    }

    /**
     * Arranca la simulación en vivo en background. Carga datos de BD, organiza
     * épocas y las procesa con ritmo controlado emitiendo por WebSocket.
     */
    @Async("planningExecutor")
    //@Transactional(readOnly = true)
    public void iniciar(Long runId, LiveParams params) {
        AtomicBoolean cancelado = new AtomicBoolean(false);
        cancelaciones.put(runId, cancelado);
        String topic = "/topic/simulacion/" + runId;
        // Una simulación a la vez: protege el estado mutable de los singletons.
        simulacionLock.lock();
        try {
            if (cancelado.get()) {
                return; // cancelada mientras esperaba turno
            }
            // --- Cargar datos de BD a dominio ---
            Map<String, Aeropuerto> aeropuertosByIcao = new HashMap<>();
            for (AirportEntity e : airportRepository.findAll()) {
                aeropuertosByIcao.put(e.getCodigoIcao(), DomainMapper.airportToDomain(e));
            }
            if (aeropuertosByIcao.isEmpty()) {
                throw new IllegalStateException("No hay aeropuertos en la BD.");
            }
            List<Vuelo> vuelos = new ArrayList<>();
            for (FlightEntity f : flightRepository.findAllWithAirports()) {
                Aeropuerto o = aeropuertosByIcao.get(f.getAeropuertoOrigen().getCodigoIcao());
                Aeropuerto d = aeropuertosByIcao.get(f.getAeropuertoDestino().getCodigoIcao());
                if (o != null && d != null) vuelos.add(DomainMapper.flightToDomain(f, o, d));
            }
//            for (FlightEntity f : flightRepository.findAll()) {
//                Aeropuerto o = aeropuertosByIcao.get(f.getAeropuertoOrigen().getCodigoIcao());
//                Aeropuerto d = aeropuertosByIcao.get(f.getAeropuertoDestino().getCodigoIcao());
//                if (o != null && d != null) vuelos.add(DomainMapper.flightToDomain(f, o, d));
//            }
            // Cargar SOLO los envíos de la ventana temporal de la simulación, no
            // todos los de la BD. Con el dataset real (~9.5M envíos repartidos en
            // meses) un findAll() reventaría la memoria; la simulación solo usa los
            // envíos creados dentro de su horizonte. Ventana: [inicio, inicio +
            // horizonDays] con 1 día de margen al inicio (organizarEnEpocas puede
            // arrancar la víspera del primer envío).
            LocalDateTime ventanaInicio = resolverVentanaInicio(params.fechaInicio());
            LocalDateTime ventanaFin = ventanaInicio
                    .plusDays(Math.max(1, params.horizonDays()) + 1);
            List<Envio> envios = new ArrayList<>();
            for (ShipmentEntity s : shipmentRepository
                    .findByFechaHoraCreacionBetweenWithAirports(ventanaInicio, ventanaFin)) {
                Aeropuerto o = aeropuertosByIcao.get(s.getAeropuertoOrigen().getCodigoIcao());
                Aeropuerto d = aeropuertosByIcao.get(s.getAeropuertoDestino().getCodigoIcao());
                if (o != null && d != null) envios.add(DomainMapper.shipmentToDomain(s, o, d));
            }
//            for (ShipmentEntity s : shipmentRepository
//                    .findByFechaHoraCreacionBetween(ventanaInicio, ventanaFin)) {
//                Aeropuerto o = aeropuertosByIcao.get(s.getAeropuertoOrigen().getCodigoIcao());
//                Aeropuerto d = aeropuertosByIcao.get(s.getAeropuertoDestino().getCodigoIcao());
//                if (o != null && d != null) envios.add(DomainMapper.shipmentToDomain(s, o, d));
//            }
            
            log.info("Simulación {}: cargados {} envíos en ventana [{}, {}]",
                    runId, envios.size(), ventanaInicio, ventanaFin);
            List<Aeropuerto> aeropuertos = new ArrayList<>(aeropuertosByIcao.values());

            int totalEnviosOriginal = envios.size();
            // --- Modo colapso: multiplicar la carga para saturar el sistema ---
            if (params.modoColapso() && params.factorCarga() > 1) {
                envios = multiplicarCarga(envios, params.factorCarga());
            }

            // --- Organizar épocas ---
            // Copia local: organizarEnEpocas devuelve la lista interna del
            // singleton; trabajar sobre una copia evita iterarla si algo más
            // la tocara (defensa extra; el lock ya serializa las simulaciones).
            List<EpocaData> epocas = new ArrayList<>(simuladorEpocas.organizarEnEpocas(
                    envios, aeropuertos, params.fechaInicio(),
                    params.epochHours(), params.horizonDays()));

            if (epocas.isEmpty()) {
                emitir(topic, SimulationEventResponse.builder()
                        .tipo("ERROR").runId(runId)
                        .mensaje("No hay épocas que simular (¿hay envíos en el rango?).")
                        .build());
                return;
            }

            // --- Construir grafo ---
            LocalDate inicioHorizonte = epocas.get(0).getInicio().toLocalDate();
            grafoVuelos.construir(aeropuertos, vuelos, inicioHorizonte, Math.max(1, params.horizonDays()));

            DHGSAlgorithm dhgs = params.algoritmo() != OptimizationAlgorithm.IALNS
                    ? new DHGSAlgorithm(constructorSoluciones, split, calculadorFitness, validador) : null;
            IALNSAlgorithm ialns = params.algoritmo() == OptimizationAlgorithm.IALNS
                    ? new IALNSAlgorithm(constructorSoluciones, split, calculadorFitness, validador) : null;

            // Salto de consumo: cuánto tiempo REAL (ms) debe durar cada época.
            long pausaMsPorEpoca = calcularPausaMs(params.epochHours(), params.multiplicadorTemporal());

            emitir(topic, SimulationEventResponse.builder()
                    .tipo("INICIO").runId(runId)
                    .totalEpocas(epocas.size())
                    .inicioEpoca(epocas.get(0).getInicio())
                    .finEpoca(epocas.get(epocas.size() - 1).getFin())
                    .mensaje(String.format("Simulación iniciada: %d épocas, multiplicador x%d (%d ms/época).",
                            epocas.size(), params.multiplicadorTemporal(), pausaMsPorEpoca))
                    .build());
            
            actualizarRunMensaje(
                    runId,
                    "Simulación iniciada: " + epocas.size() + " épocas."
            );
            
            // --- Loop de épocas contra el reloj ---
            List<Envio> pendientes = new ArrayList<>();
            int totalAsignados = 0;
            boolean colapsoDetectado = false;
            Map<String, Double> ultimaOcupacion = new HashMap<>();

            for (EpocaData epoca : epocas) {
                if (cancelado.get()) {
                    String mensaje = "Simulación cancelada por el usuario.";

                    emitir(topic, SimulationEventResponse.builder()
                            .tipo("FIN").runId(runId)
                            .mensaje(mensaje)
                            .totalAsignadosAcumulado(totalAsignados)
                            .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                            .build());

                    finalizarRun(
                            runId,
                            PlanningRunStatus.FAILED,
                            mensaje,
                            totalAsignados,
                            pendientes.size(),
                            simuladorEpocas.getCostoAcumulado()
                    );

                    return;
                }
//                if (cancelado.get()) {
//                    emitir(topic, SimulationEventResponse.builder()
//                            .tipo("FIN").runId(runId).mensaje("Simulación cancelada por el usuario.")
//                            .totalAsignadosAcumulado(totalAsignados)
//                            .costoAcumulado(simuladorEpocas.getCostoAcumulado())
//                            .build());
//                    return;
//                }

                simuladorEpocas.prepararEpoca(epoca, pendientes);
                List<Envio> enviosEpoca = epoca.getTodosLosEnvios();

                Individuo mejor = null;
                if (!enviosEpoca.isEmpty()) {
                    Duration limite = Duration.ofSeconds(Math.max(1, params.timeLimitSeconds()));
                    mejor = params.algoritmo() == OptimizationAlgorithm.IALNS
                            ? ialns.ejecutar(enviosEpoca, epoca.getNumeroEpoca(), epocas.size(),
                                params.populationSize(), limite)
                            : dhgs.ejecutar(enviosEpoca, epoca.getNumeroEpoca(), epocas.size(),
                                params.populationSize(), limite);
                }

                pendientes = simuladorEpocas.finalizarEpoca(epoca, mejor);

                List<RutaDTO> rutas = new ArrayList<>();
                if (mejor != null && mejor.getEnviosAsignados() != null && !mejor.getEnviosAsignados().isEmpty()) {
                    totalAsignados += mejor.getEnviosAsignados().size();

                    planningRoutePersistenceService.guardarRutasDeEpoca(
                            runId,
                            epoca.getNumeroEpoca(),
                            mejor
                    );

                    mejor.getEnviosAsignados().forEach((envio, ruta) ->
                            rutas.add(RutaDTO.from(envio, ruta)));
                }

                ultimaOcupacion = ocupacionDe(epoca);

                emitir(topic, SimulationEventResponse.builder()
                        .tipo("EPOCA").runId(runId)
                        .numeroEpoca(epoca.getNumeroEpoca())
                        .totalEpocas(epocas.size())
                        .inicioEpoca(epoca.getInicio())
                        .finEpoca(epoca.getFin())
                        .relojSimulado(epoca.getFin())
                        .enviosDespachados(epoca.getEnviosDespachados() != null ? epoca.getEnviosDespachados().size() : 0)
                        .enviosPostpuestos(pendientes.size())
                        .costoEpoca(epoca.getCostoEpoca())
                        .rutas(rutas)
                        .ocupacionAlmacenes(ultimaOcupacion)
                        .totalAsignadosAcumulado(totalAsignados)
                        .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                        .build());
                
                actualizarRunProgreso(
                        runId,
                        epoca.getNumeroEpoca(),
                        epocas.size(),
                        totalAsignados,
                        pendientes.size(),
                        simuladorEpocas.getCostoAcumulado()
                );
                
                // --- Detección de colapso ---
                if (params.modoColapso()) {
                    boolean almacenSaturado = ultimaOcupacion.values().stream()
                            .anyMatch(pct -> pct >= 100.0);
                    int totalConsiderado = totalAsignados + pendientes.size();
                    double pctSinAtender = totalConsiderado > 0
                            ? (pendientes.size() * 100.0) / totalConsiderado : 0.0;
                    if (almacenSaturado || pctSinAtender >= params.umbralColapso()) {
                        colapsoDetectado = true;
                        CollapseReportResponse reporte = construirReporte(
                                true, params.factorCarga(), epoca.getNumeroEpoca(), epoca.getFin(),
                                almacenSaturado ? "Almacén saturado (capacidad excedida)."
                                        : String.format("%.0f%% de envíos sin atender (umbral %.0f%%).",
                                                pctSinAtender, params.umbralColapso()),
                                totalEnviosOriginal * Math.max(1, params.factorCarga()),
                                totalAsignados, pendientes.size(), ultimaOcupacion);
                        emitir(topic, SimulationEventResponse.builder()
                                .tipo("COLAPSO").runId(runId)
                                .numeroEpoca(epoca.getNumeroEpoca())
                                .totalEpocas(epocas.size())
                                .relojSimulado(epoca.getFin())
                                .totalAsignadosAcumulado(totalAsignados)
                                .ocupacionAlmacenes(ultimaOcupacion)
                                .reporteColapso(reporte)
                                .mensaje("⚠ COLAPSO detectado: " + reporte.getMotivo())
                                .build());
                        
                        finalizarRun(
                                runId,
                                PlanningRunStatus.COMPLETED_WITH_PENDING_SHIPMENTS,
                                "COLAPSO detectado: " + reporte.getMotivo(),
                                totalAsignados,
                                pendientes.size(),
                                simuladorEpocas.getCostoAcumulado()
                        );
                        return;
                    }
                }

                dormir(pausaMsPorEpoca, cancelado);
            }

            // Fin sin colapso (o simulación normal de periodo)
            SimulationEventResponse.SimulationEventResponseBuilder fin = SimulationEventResponse.builder()
                    .tipo("FIN").runId(runId)
                    .totalEpocas(epocas.size())
                    .totalAsignadosAcumulado(totalAsignados)
                    .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                    .mensaje(String.format("Simulación finalizada: %d asignados, %d pendientes.",
                            totalAsignados, pendientes.size()));
            if (params.modoColapso() && !colapsoDetectado) {
                fin.reporteColapso(construirReporte(false, params.factorCarga(), null, null,
                        "El sistema absorbió toda la carga sin colapsar (prueba con un factor mayor).",
                        totalEnviosOriginal * Math.max(1, params.factorCarga()),
                        totalAsignados, pendientes.size(), ultimaOcupacion));
            }
            emitir(topic, fin.build());
            
            PlanningRunStatus statusFinal = pendientes.isEmpty()
            ? PlanningRunStatus.COMPLETED
            : PlanningRunStatus.COMPLETED_WITH_PENDING_SHIPMENTS;

            finalizarRun(
                    runId,
                    statusFinal,
                    String.format("Simulación finalizada: %d asignados, %d pendientes.",
                            totalAsignados, pendientes.size()),
                    totalAsignados,
                    pendientes.size(),
                    simuladorEpocas.getCostoAcumulado()
            );

        } catch (Exception ex) {
            
            log.error("Simulación en vivo {} falló", runId, ex);
            
            String mensaje = "Error: "
                    + (ex.getMessage() == null
                    ? ex.getClass().getSimpleName()
                    : ex.getMessage());

            emitir(topic, SimulationEventResponse.builder()
                    .tipo("ERROR").runId(runId)
                    .mensaje(mensaje)
                    .build());

            finalizarRun(
                    runId,
                    PlanningRunStatus.FAILED,
                    mensaje,
                    0,
                    0,
                    0.0
            );
        } finally {
            cancelaciones.remove(runId);
            simulacionLock.unlock();
        }
    }

    // --- helpers ---

    /**
     * ms reales que debe durar una época dado el multiplicador temporal.
     * epochHours horas simuladas / multiplicador = horas reales → ms.
     */
    static long calcularPausaMs(long epochHours, int multiplicadorTemporal) {
        int mult = Math.max(1, multiplicadorTemporal);
        double segundosReales = (epochHours * 3600.0) / mult;
        return Math.round(segundosReales * 1000.0);
    }

    /**
     * Inicio de la ventana de carga de envíos. Si la simulación trae fecha de
     * inicio, se usa esa; si no, se infiere del envío más antiguo de la BD
     * arrancando la víspera (igual que {@code SimuladorEpocas.resolverFechaInicio}),
     * para no dejar envíos fuera de la línea de tiempo. Sin envíos: ahora.
     */
    private LocalDateTime resolverVentanaInicio(LocalDateTime fechaInicioSolicitada) {
        if (fechaInicioSolicitada != null) {
            return fechaInicioSolicitada;
        }
        return shipmentRepository.findFirstByOrderByFechaHoraCreacionAsc()
                .map(s -> s.getFechaHoraCreacion().toLocalDate().minusDays(1).atStartOfDay())
                .orElse(LocalDateTime.now());
    }

    private Map<String, Double> ocupacionDe(EpocaData epoca) {
        Map<String, Double> ocup = new HashMap<>();
        if (epoca.getEstadoAlmacenes() != null) {
            for (Map.Entry<String, AlmacenEstado> e : epoca.getEstadoAlmacenes().entrySet()) {
                ocup.put(e.getKey(), e.getValue().getNivelOcupacion() * 100);
            }
        }
        return ocup;
    }

    /** Duplica la carga {@code factor} veces, clonando envíos con id único. */
    private List<Envio> multiplicarCarga(List<Envio> originales, int factor) {
        List<Envio> resultado = new ArrayList<>(originales);
        for (int copia = 1; copia < factor; copia++) {
            for (Envio src : originales) {
                Envio e = new Envio();
                e.setId(src.getId() + "-C" + copia);
                e.setAeropuertoOrigen(src.getAeropuertoOrigen());
                e.setAeropuertoDestino(src.getAeropuertoDestino());
                e.setFechaHoraCreacion(src.getFechaHoraCreacion());
                e.setCantidadMaletas(src.getCantidadMaletas());
                e.setIdCliente(src.getIdCliente());
                resultado.add(e);
            }
        }
        return resultado;
    }

    private CollapseReportResponse construirReporte(boolean colapso, int factor,
            Integer epoca, LocalDateTime momento, String motivo,
            int totalCargados, int totalAsignados, int sinAtender,
            Map<String, Double> ocupacion) {
        double pct = (totalAsignados + sinAtender) > 0
                ? (sinAtender * 100.0) / (totalAsignados + sinAtender) : 0.0;
        List<String> saturados = ocupacion.entrySet().stream()
                .filter(en -> en.getValue() >= 85.0)
                .sorted(Map.Entry.<String, Double>comparingByValue().reversed())
                .map(Map.Entry::getKey)
                .toList();
        return CollapseReportResponse.builder()
                .colapso(colapso)
                .factorCarga(factor)
                .epocaColapso(epoca)
                .momentoColapso(momento)
                .motivo(motivo)
                .totalEnviosCargados(totalCargados)
                .totalAsignados(totalAsignados)
                .totalSinAtender(sinAtender)
                .porcentajeSinAtender(Math.round(pct * 100.0) / 100.0)
                .ocupacionFinal(ocupacion)
                .aeropuertosSaturados(saturados)
                .build();
    }

    private void emitir(String topic, SimulationEventResponse evento) {
        messaging.convertAndSend(topic, evento);
    }

    private void dormir(long ms, AtomicBoolean cancelado) {
        // Trocea la espera para reaccionar rápido a cancelaciones.
        long restante = ms;
        long paso = 200;
        while (restante > 0 && !cancelado.get()) {
            try {
                Thread.sleep(Math.min(paso, restante));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            restante -= paso;
        }
    }
    
    private void actualizarRunMensaje(Long runId, String mensaje) {
        planningRunRepository.findById(runId).ifPresent(run -> {
            run.setMensaje(mensaje);
            planningRunRepository.save(run);
        });
    }

    private void actualizarRunProgreso(
            Long runId,
            int epocaActual,
            int totalEpocas,
            int totalAsignados,
            int pendientes,
            double costoAcumulado
    ) {
        planningRunRepository.findById(runId).ifPresent(run -> {
            run.setMensaje("Procesando época " + epocaActual + " de " + totalEpocas);
            run.setTotalEnviosAsignados(totalAsignados);
            run.setTotalEnviosNoAsignados(pendientes);
            run.setCostoTotal(costoAcumulado);
            planningRunRepository.save(run);
        });
    }

    private void finalizarRun(
            Long runId,
            PlanningRunStatus status,
            String mensaje,
            int totalAsignados,
            int pendientes,
            double costoAcumulado
    ) {
        planningRunRepository.findById(runId).ifPresent(run -> {
            run.setStatus(status);
            run.setFinishedAt(LocalDateTime.now());
            run.setMensaje(mensaje);
            run.setTotalEnviosAsignados(totalAsignados);
            run.setTotalEnviosNoAsignados(pendientes);
            run.setCostoTotal(costoAcumulado);
            planningRunRepository.save(run);
        });
    }
}
