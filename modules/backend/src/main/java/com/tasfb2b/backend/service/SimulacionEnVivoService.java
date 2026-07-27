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
import com.tasfb2b.backend.dto.response.VueloEpocaDTO;
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
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.domain.valueobject.HoraLocal;
import com.tasfb2b.dhgs.demo.domain.service.CancelacionVuelos;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
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
     * Estado vivo de la corrida en curso, para poder cancelar vuelos mientras
     * transcurre (P&R P9). La cancelación llega por REST desde otro hilo, así que
     * necesita alcanzar el reloj simulado y la solución de la época actual.
     *
     * <p>Solo hay una corrida a la vez ({@code simulacionLock}), de ahí que baste
     * una única referencia en vez de un mapa por runId.
     */
    private final AtomicReference<CorridaEnCurso> corridaActual = new AtomicReference<>();

    /**
     * Punto de encuentro entre el hilo de la simulación y las peticiones de
     * cancelación. El reloj simulado y la solución vigente cambian en cada época;
     * las peticiones los leen a través de esta referencia.
     */
    private static final class CorridaEnCurso {
        private final Long runId;
        private final String topic;
        /** Fin de la última época procesada: el "ahora" de la operación simulada. */
        private volatile LocalDateTime relojSimulado;
        /** Solución de la época en curso, de donde se retiran los envíos afectados. */
        private volatile Individuo solucionVigente;
        /** Envíos liberados por cancelaciones, a replanificar en la próxima época. */
        private final List<Envio> liberadosPendientes = Collections.synchronizedList(new ArrayList<>());

        CorridaEnCurso(Long runId, String topic, LocalDateTime relojInicial) {
            this.runId = runId;
            this.topic = topic;
            this.relojSimulado = relojInicial;
        }
    }

    /**
     * Serializa las simulaciones: SimuladorEpocas y GrafoVuelos son beans
     * singleton con estado mutable compartido. Dos simulaciones a la vez se
     * corromperían entre sí (p.ej. organizarEnEpocas hace historial.clear()).
     * El lock garantiza una simulación a la vez; las demás esperan su turno.
     */
    private final ReentrantLock simulacionLock = new ReentrantLock();

    /**
     * Segundos que una corrida nueva espera a que la anterior suelte el turno.
     *
     * <p>Generoso a propósito: la previa tiene que terminar la época que esté
     * calculando, y con decenas de miles de envíos una época puede tardar
     * bastante. Pasado ese margen es mejor avisar que seguir esperando en
     * silencio.
     */
    private static final long ESPERA_MAXIMA_TURNO_SEGUNDOS = 90;

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
     * Cancela un vuelo durante la simulación en curso (P&R P9).
     *
     * <p>La antelación se mide contra el <b>reloj simulado</b>, no contra la hora
     * real: si la simulación va por el 15-jul a las 02:00, cancelar un vuelo de
     * las 09:00 de ese día debe alcanzarlo, aunque en tiempo real hayan pasado
     * apenas unos minutos desde que arrancó la corrida.
     *
     * <p>Los envíos que iban en el vuelo quedan a la espera y entran como
     * pendientes en la siguiente época, que es la que los replanifica.
     *
     * @param idVuelo identificador del vuelo recurrente (business id)
     * @return descripción de lo ocurrido, para responder al operador
     */
    public CancelacionVueloResultado cancelarVuelo(String idVuelo) {
        CorridaEnCurso corrida = corridaActual.get();
        if (corrida == null) {
            return new CancelacionVueloResultado(false, null, null, 0, 0,
                    "No hay una simulación en curso sobre la que cancelar.");
        }

        CancelacionVuelos.Resultado resultado = CancelacionVuelos.cancelar(
                grafoVuelos, idVuelo, corrida.relojSimulado, corrida.solucionVigente);

        if (!resultado.seAplico()) {
            return new CancelacionVueloResultado(false, idVuelo, null, 0, 0,
                    "No hay ninguna salida de " + idVuelo + " que pueda cancelarse:"
                            + " o el vuelo no existe, o sus salidas restantes están dentro"
                            + " de la hora previa (o ya canceladas).");
        }

        corrida.liberadosPendientes.addAll(resultado.enviosLiberados());
        InstanciaVuelo instancia = resultado.instancia();

        log.info("Cancelación: vuelo {} del {} ({} envíos liberados, {} maletas). Reloj simulado {}.",
                idVuelo, instancia.getFechaOperacion(), resultado.enviosLiberados().size(),
                resultado.maletasLiberadas(), corrida.relojSimulado);

        emitir(corrida.topic, SimulationEventResponse.builder()
                .tipo("CANCELACION").runId(corrida.runId)
                .relojSimulado(corrida.relojSimulado)
                .vueloCancelado(instancia.getId())
                .mensaje(String.format(
                        "Vuelo %s del %s cancelado: %d envío(s) liberados (%d maletas) a replanificar.",
                        idVuelo, instancia.getFechaOperacion(),
                        resultado.enviosLiberados().size(), resultado.maletasLiberadas()))
                .build());

        return new CancelacionVueloResultado(true, idVuelo, instancia.getId(),
                resultado.enviosLiberados().size(), resultado.maletasLiberadas(),
                String.format("Cancelada la salida del %s a las %s. %d envío(s) quedan a replanificar.",
                        instancia.getFechaOperacion(), instancia.getHoraSalida(),
                        resultado.enviosLiberados().size()));
    }

    /** Respuesta de una cancelación de vuelo. */
    public record CancelacionVueloResultado(
            boolean aplicada,
            String idVuelo,
            String idInstancia,
            int enviosLiberados,
            int maletasLiberadas,
            String mensaje
    ) {}

    /**
     * Arranca la simulación en vivo en background. Carga datos de BD, organiza
     * épocas y las procesa con ritmo controlado emitiendo por WebSocket.
     */
    @Async("planningExecutor")
    //@Transactional(readOnly = true)
    public void iniciar(Long runId, LiveParams params) {
        AtomicBoolean cancelado = new AtomicBoolean(false);
        // Cancelar cualquier simulación anterior que siga viva. Sin esto, como el
        // lock serializa las corridas y cada una dura minutos, una simulación
        // nueva quedaba encolada detrás de la vieja: no arrancaba, no emitía
        // INICIO y en el front "no pasaba nada". Al marcar las previas como
        // canceladas, su loop de épocas (que trocea la espera) las libera pronto
        // y esta toma el lock enseguida.
        for (Map.Entry<Long, AtomicBoolean> e : cancelaciones.entrySet()) {
            if (!e.getKey().equals(runId)) {
                e.getValue().set(true);
                log.info("Simulación {}: cancelando simulación previa {} para tomar su turno.",
                        runId, e.getKey());
            }
        }
        cancelaciones.put(runId, cancelado);
        String topic = "/topic/simulacion/" + runId;

        // Una simulación a la vez: protege el estado mutable de los singletons.
        //
        // La espera es ACOTADA. Marcar la corrida previa como cancelada no la
        // detiene en el acto: termina la época que estuviera calculando, y con
        // decenas de miles de envíos eso puede llevar bastantes segundos. Con un
        // lock() sin límite, la nueva corrida se quedaba esperando en silencio y
        // el front mostraba la anterior congelada a media barra, sin saber que
        // había una detrás haciendo cola.
        boolean turno;
        try {
            turno = simulacionLock.tryLock(ESPERA_MAXIMA_TURNO_SEGUNDOS, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            cancelaciones.remove(runId);
            return;
        }
        if (!turno) {
            log.warn("Simulación {}: la corrida anterior no liberó el turno en {} s.",
                    runId, ESPERA_MAXIMA_TURNO_SEGUNDOS);
            emitir(topic, SimulationEventResponse.builder()
                    .tipo("ERROR").runId(runId)
                    .mensaje("Hay otra simulación terminando de cerrarse y no liberó el turno a tiempo."
                            + " Espera unos segundos y vuelve a iniciar.")
                    .build());
            finalizarRun(runId, PlanningRunStatus.FAILED,
                    "No se pudo tomar el turno: otra simulación seguía en curso.", 0, 0, 0.0);
            cancelaciones.remove(runId);
            return;
        }

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
                // Decir solo "¿hay envíos en el rango?" deja al operador
                // adivinando cuál es el rango bueno. Con la base cargada por
                // partes (o a medio importar) es fácil elegir una fecha vacía,
                // así que se informa qué periodo tiene datos.
                ShipmentEntity primero = shipmentRepository
                        .findFirstByOrderByFechaHoraCreacionAsc().orElse(null);
                ShipmentEntity ultimo = shipmentRepository
                        .findFirstByOrderByFechaHoraCreacionDesc().orElse(null);
                String rango = (primero == null || ultimo == null)
                        ? " La tabla de envíos está vacía: importa datos antes de simular."
                        : String.format(" La base tiene envíos entre %s y %s.",
                                primero.getFechaHoraCreacion().toLocalDate(),
                                ultimo.getFechaHoraCreacion().toLocalDate());

                emitir(topic, SimulationEventResponse.builder()
                        .tipo("ERROR").runId(runId)
                        .mensaje(String.format(
                                "No hay envíos entre %s y %s, así que no hay nada que simular.%s",
                                ventanaInicio.toLocalDate(), ventanaFin.toLocalDate(), rango))
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

            // P&R P9: a partir de aquí la corrida acepta cancelaciones de vuelo.
            // El reloj arranca al inicio de la primera época: cancelar antes de
            // que termine la primera todavía puede alcanzar a vuelos de ese día.
            CorridaEnCurso corrida = new CorridaEnCurso(runId, topic, epocas.get(0).getInicio());
            corridaActual.set(corrida);

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

                // C29: el ritmo de la simulación se mide desde que arranca el
                // ciclo de la época, no desde que termina de calcularla. Así el
                // tiempo de planificación se descuenta de la pausa y la
                // reproducción avanza a intervalos parejos, sin los saltos que
                // producía esperar la pausa completa DESPUÉS del cómputo.
                long inicioCicloMs = System.currentTimeMillis();

                // P&R P9: los envíos que perdieron su vuelo por una cancelación
                // entran a esta época como pendientes — es lo que significa que
                // "quedan disponibles para ser nuevamente planificados".
                synchronized (corrida.liberadosPendientes) {
                    if (!corrida.liberadosPendientes.isEmpty()) {
                        log.info("Época {}: {} envío(s) liberados por cancelación entran a replanificar.",
                                epoca.getNumeroEpoca(), corrida.liberadosPendientes.size());
                        pendientes.addAll(corrida.liberadosPendientes);
                        corrida.liberadosPendientes.clear();
                    }
                }

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

                // Corte inmediato tras planificar: si mientras se calculaba esta
                // época llegó una cancelación (o una corrida nueva pidiendo el
                // turno), no tiene sentido persistir rutas ni emitir eventos de
                // una simulación que ya nadie mira. Sin esto, el trabajo restante
                // de la época retenía el lock varios segundos más.
                if (cancelado.get()) {
                    log.info("Simulación {}: cancelada durante la época {}; libera el turno.",
                            runId, epoca.getNumeroEpoca());
                    emitir(topic, SimulationEventResponse.builder()
                            .tipo("FIN").runId(runId)
                            .mensaje("Simulación cancelada por el usuario.")
                            .totalAsignadosAcumulado(totalAsignados)
                            .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                            .build());
                    finalizarRun(runId, PlanningRunStatus.FAILED,
                            "Simulación cancelada por el usuario.",
                            totalAsignados, pendientes.size(),
                            simuladorEpocas.getCostoAcumulado());
                    return;
                }

                pendientes = simuladorEpocas.finalizarEpoca(epoca, mejor);

                // Estado visible para las cancelaciones que lleguen mientras se
                // reproduce esta época: el reloj avanza al final de la ventana ya
                // planificada, y la solución es de donde se retiran los envíos
                // que viajaban en el vuelo cancelado.
                corrida.solucionVigente = mejor;
                corrida.relojSimulado = epoca.getFin();

                List<RutaDTO> rutas = new ArrayList<>();
                if (mejor != null && mejor.getEnviosAsignados() != null && !mejor.getEnviosAsignados().isEmpty()) {
                    totalAsignados += mejor.getEnviosAsignados().size();

                    // C29: en segundo plano. La animación no espera a la BD; el
                    // colapso se detecta sobre el Individuo en memoria.
                    planningRoutePersistenceService.guardarRutasDeEpocaAsync(
                            runId,
                            epoca.getNumeroEpoca(),
                            mejor
                    );

                    mejor.getEnviosAsignados().forEach((envio, ruta) ->
                            rutas.add(RutaDTO.from(envio, ruta)));
                }

                ultimaOcupacion = ocupacionDe(epoca);

                List<VueloEpocaDTO> vuelosEpoca = vuelosDeEpoca(epoca, mejor);

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
                        .vuelosEpoca(vuelosEpoca)
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
                //
                // El enunciado lo define sin ambigüedad: el colapso es que "el
                // sistema logístico de la empresa ya no cumpla con entregar AL
                // MENOS UNA MALETA". No es un porcentaje de carga pendiente: un
                // envío postpuesto a la época siguiente todavía puede llegar a
                // tiempo, y contarlo como fallo daría una fecha de colapso
                // demasiado temprana.
                //
                // Lo que sí es un incumplimiento es una maleta que ya no puede
                // entregarse dentro de su plazo. Se detectan dos formas:
                //   - una ruta planificada que entrega DESPUÉS del deadline;
                //   - un envío pendiente cuyo deadline ya venció mientras esperaba.
                if (params.modoColapso()) {
                    IncumplimientoPlazo incumplimiento =
                            detectarIncumplimiento(mejor, pendientes, epoca.getFin());
                    boolean almacenSaturado = ultimaOcupacion.values().stream()
                            .anyMatch(pct -> pct >= 100.0);

                    if (incumplimiento != null || almacenSaturado) {
                        colapsoDetectado = true;
                        String motivo = incumplimiento != null
                                ? incumplimiento.descripcion()
                                : "Almacén saturado: la capacidad de un aeropuerto quedó excedida.";
                        CollapseReportResponse reporte = construirReporte(
                                true, params.factorCarga(), epoca.getNumeroEpoca(), epoca.getFin(),
                                motivo,
                                totalEnviosOriginal * Math.max(1, params.factorCarga()),
                                totalAsignados, pendientes.size(), ultimaOcupacion);
                        reporte.setEnvioIncumplido(
                                incumplimiento != null ? incumplimiento.envioId() : null);
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
                        
                        // La fecha va PRIMERO en el mensaje: es el dato que la
                        // entrega pide mostrar, y el reporte persistido (que se
                        // consulta después, ya sin el evento WebSocket) solo
                        // conserva este texto.
                        finalizarRun(
                                runId,
                                PlanningRunStatus.COMPLETED_WITH_PENDING_SHIPMENTS,
                                String.format("COLAPSO LOGÍSTICO el %s. %s",
                                        epoca.getFin(), reporte.getMotivo()),
                                totalAsignados,
                                pendientes.size(),
                                simuladorEpocas.getCostoAcumulado()
                        );
                        return;
                    }
                }

                // C29: el ritmo lo marca el ciclo completo (planificar + pausa),
                // no la pausa sola. Si planificar ya consumió el tiempo de la
                // época no se espera nada más: antes se sumaba la pausa íntegra
                // al cómputo y la reproducción se quedaba congelada.
                //
                // El coste de planificar varía mucho con la carga de la época
                // (unos segundos con pocos envíos, más de un minuto con miles),
                // así que sin este descuento la cadencia era irregular y el mapa
                // alternaba avances rápidos con parones largos.
                long computoMs = System.currentTimeMillis() - inicioCicloMs;
                long esperaMs = Math.max(0, pausaMsPorEpoca - computoMs);
                if (computoMs > pausaMsPorEpoca) {
                    log.debug("Época {} tardó {} ms en planificar, por encima del ritmo objetivo de {} ms",
                            epoca.getNumeroEpoca(), computoMs, pausaMsPorEpoca);
                }
                dormir(esperaMs, cancelado);
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
            // Deja de aceptar cancelaciones de vuelo salvo que la corrida que
            // publicó el estado sea otra (una simulación posterior ya tomó el
            // relevo y su estado no debe borrarse aquí).
            corridaActual.updateAndGet(actual ->
                    actual != null && runId.equals(actual.runId) ? null : actual);
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

    /**
     * C27: vuelos que operan durante la época con la carga que realmente
     * transportan. Recorre las rutas asignadas acumulando maletas por instancia
     * de vuelo y añade, con 0 maletas, las instancias que despegan dentro de la
     * época sin llevar ningún envío: son los vuelos <b>vacíos</b> que el mapa
     * debe pintar en gris. Deducirlos en el frontend a partir del catálogo
     * produciría aviones que la planificación nunca despachó.
     */
    private List<VueloEpocaDTO> vuelosDeEpoca(EpocaData epoca, Individuo mejor) {
        Map<String, VueloEpocaDTO> porInstancia = new LinkedHashMap<>();

        if (mejor != null && mejor.getEnviosAsignados() != null) {
            for (Map.Entry<Envio, RutaEnvio> asignacion : mejor.getEnviosAsignados().entrySet()) {
                RutaEnvio ruta = asignacion.getValue();
                if (ruta == null || ruta.getSecuenciaVuelos() == null) continue;
                int maletas = asignacion.getKey().getCantidadMaletas();

                for (Vuelo vuelo : ruta.getSecuenciaVuelos()) {
                    VueloEpocaDTO dto = porInstancia.computeIfAbsent(claveInstancia(vuelo),
                            k -> nuevoVueloEpoca(vuelo));
                    if (dto == null) continue;
                    dto.setMaletas(dto.getMaletas() + maletas);
                    dto.setEnvios(dto.getEnvios() + 1);
                }
            }
        }

        // Vuelos vacíos: solo sobre TRAMOS que la planificación está usando en
        // esta época. Filtrar por aeropuerto no alcanza (la operación toca casi
        // todos los aeropuertos, así que pasaba el catálogo entero); el tramo
        // origen→destino sí acota a rutas realmente operadas, que además son las
        // únicas con trayectoria dibujada en el mapa.
        Set<String> tramosOperando = new HashSet<>();
        for (VueloEpocaDTO conCarga : porInstancia.values()) {
            if (conCarga != null) {
                tramosOperando.add(conCarga.getOrigenIcao() + "-" + conCarga.getDestinoIcao());
            }
        }

        if (!tramosOperando.isEmpty()) {
            for (List<Vuelo> salientes : grafoVuelos.getAdyacencia().values()) {
                for (Vuelo vuelo : salientes) {
                    if (!(vuelo instanceof InstanciaVuelo instancia)) continue;
                    if (vuelo.getAeropuertoOrigen() == null || vuelo.getAeropuertoDestino() == null) continue;
                    // La época está acotada en UTC (SimuladorEpocas); la salida del
                    // catálogo vive en hora LOCAL del aeropuerto de origen. Sin
                    // convertir, un vuelo de un aeropuerto con huso distinto de 0
                    // quedaba fuera de la época que realmente le correspondía (o
                    // colado en otra), y por eso faltaban aviones vacíos en el mapa.
                    LocalDateTime salida = HoraLocal.aUtc(
                            instancia.getFechaHoraSalida(), vuelo.getAeropuertoOrigen());
                    if (salida == null || salida.isBefore(epoca.getInicio()) || !salida.isBefore(epoca.getFin())) {
                        continue;
                    }
                    String tramo = vuelo.getAeropuertoOrigen().getCodigoICAO()
                            + "-" + vuelo.getAeropuertoDestino().getCodigoICAO();
                    if (!tramosOperando.contains(tramo)) continue;
                    porInstancia.computeIfAbsent(claveInstancia(vuelo), k -> nuevoVueloEpoca(vuelo));
                }
            }
        }

        List<VueloEpocaDTO> resultado = new ArrayList<>(porInstancia.size());
        for (VueloEpocaDTO dto : porInstancia.values()) {
            if (dto != null) resultado.add(dto);
        }
        return resultado;
    }

    /** Clave única de una ocurrencia concreta de vuelo (plantilla + salida). */
    private String claveInstancia(Vuelo vuelo) {
        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraSalida() != null) {
            return vuelo.getId() + "@" + instancia.getFechaHoraSalida();
        }
        return String.valueOf(vuelo.getId());
    }

    /**
     * Construye el DTO base de un vuelo (sin carga todavía).
     *
     * <p>El catálogo guarda salida/llegada en hora LOCAL de cada punta (origen y
     * destino respectivamente), igual que en la operación día a día. El mapa
     * compara estos campos contra el reloj simulado, que vive en UTC, así que
     * hay que convertir explícitamente: mandar la hora local tal cual hacía que
     * un vuelo desde un aeropuerto con huso negativo apareciera "en vuelo" (o
     * "aterrizado") en el momento equivocado, y por eso el mapa en vivo no
     * mostraba todos los aviones que sí debían estar volando.
     */
    private VueloEpocaDTO nuevoVueloEpoca(Vuelo vuelo) {
        if (vuelo.getAeropuertoOrigen() == null || vuelo.getAeropuertoDestino() == null) return null;
        LocalDateTime salida = null;
        LocalDateTime llegada = null;
        if (vuelo instanceof InstanciaVuelo instancia) {
            salida = HoraLocal.aUtc(instancia.getFechaHoraSalida(), vuelo.getAeropuertoOrigen());
            llegada = HoraLocal.aUtc(instancia.getFechaHoraLlegada(), vuelo.getAeropuertoDestino());
        }
        return VueloEpocaDTO.builder()
                .businessId(vuelo.getId())
                .origenIcao(vuelo.getAeropuertoOrigen().getCodigoICAO())
                .destinoIcao(vuelo.getAeropuertoDestino().getCodigoICAO())
                .salida(salida)
                .llegada(llegada)
                .capacidad(vuelo.getCapacidad())
                .maletas(0)
                .envios(0)
                .build();
    }

    /** Primera maleta que el sistema ya no puede entregar dentro de su plazo. */
    private record IncumplimientoPlazo(String envioId, String descripcion) {
    }

    /**
     * Busca la primera maleta que incumple su plazo, que es como el enunciado
     * define el colapso: "hasta que el sistema logístico de la empresa ya no
     * cumpla con entregar al menos una maleta".
     *
     * <p>Se miran las dos formas en que eso ocurre:
     * <ul>
     *   <li><b>Ruta tardía</b>: la planificación asignó el envío, pero la entrega
     *       (llegada del último vuelo + recojo) cae después del deadline. La
     *       propia {@code RutaEnvio} ya sabe calcular ese retraso.</li>
     *   <li><b>Pendiente vencido</b>: el envío sigue sin ruta y su deadline ya
     *       pasó. No hace falta esperar a que se le asigne nada: esa maleta ya
     *       no llega a tiempo.</li>
     * </ul>
     *
     * <p>Un envío meramente postpuesto NO cuenta: pasar a la época siguiente es
     * el funcionamiento normal del simulador y todavía puede entregarse dentro
     * de plazo.
     *
     * @return el primer incumplimiento encontrado, o {@code null} si no hay
     */
    private IncumplimientoPlazo detectarIncumplimiento(
            Individuo solucion, List<Envio> pendientes, LocalDateTime relojEpoca) {

        if (solucion != null && solucion.getEnviosAsignados() != null) {
            for (Map.Entry<Envio, RutaEnvio> e : solucion.getEnviosAsignados().entrySet()) {
                RutaEnvio ruta = e.getValue();
                if (ruta == null) continue;
                long retraso = ruta.getRetraso();
                if (retraso > 0) {
                    Envio envio = e.getKey();
                    return new IncumplimientoPlazo(envio.getId(), String.format(
                            "El envío %s (%s → %s, %d maletas) no llega a tiempo: se entrega %d h %d min"
                                    + " después de su plazo. El sistema ya no cumple con entregar al"
                                    + " menos una maleta.",
                            envio.getId(),
                            envio.getAeropuertoOrigen().getCodigoICAO(),
                            envio.getAeropuertoDestino().getCodigoICAO(),
                            envio.getCantidadMaletas(),
                            retraso / 60, retraso % 60));
                }
            }
        }

        if (pendientes != null) {
            for (Envio envio : pendientes) {
                LocalDateTime deadline = envio.getDeadline() != null
                        ? envio.getDeadline()
                        : envio.calcularDeadline();
                if (deadline != null && relojEpoca.isAfter(deadline)) {
                    return new IncumplimientoPlazo(envio.getId(), String.format(
                            "El envío %s (%s → %s, %d maletas) venció sin ruta asignada: su plazo"
                                    + " terminó el %s y sigue sin poder despacharse. El sistema ya no"
                                    + " cumple con entregar al menos una maleta.",
                            envio.getId(),
                            envio.getAeropuertoOrigen().getCodigoICAO(),
                            envio.getAeropuertoDestino().getCodigoICAO(),
                            envio.getCantidadMaletas(),
                            deadline));
                }
            }
        }
        return null;
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
