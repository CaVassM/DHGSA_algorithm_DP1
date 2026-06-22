package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.backend.dto.response.SimulationEventResponse;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
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
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
    private final SimuladorEpocas simuladorEpocas;
    private final GrafoVuelos grafoVuelos;
    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;
    private final SimpMessagingTemplate messaging;

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
            boolean preBuffer
    ) {}

    public void cancelar(Long runId) {
        AtomicBoolean flag = cancelaciones.get(runId);
        if (flag != null) flag.set(true);
    }

    /**
     * Arranca la simulación en vivo en background. Carga datos de BD, organiza
     * épocas y las procesa con ritmo controlado emitiendo por WebSocket.
     */
    @Async("planningExecutor")
    @Transactional(readOnly = true)
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
            for (FlightEntity f : flightRepository.findAll()) {
                Aeropuerto o = aeropuertosByIcao.get(f.getAeropuertoOrigen().getCodigoIcao());
                Aeropuerto d = aeropuertosByIcao.get(f.getAeropuertoDestino().getCodigoIcao());
                if (o != null && d != null) vuelos.add(DomainMapper.flightToDomain(f, o, d));
            }
            List<Envio> envios = new ArrayList<>();
            for (ShipmentEntity s : shipmentRepository.findAll()) {
                Aeropuerto o = aeropuertosByIcao.get(s.getAeropuertoOrigen().getCodigoIcao());
                Aeropuerto d = aeropuertosByIcao.get(s.getAeropuertoDestino().getCodigoIcao());
                if (o != null && d != null) envios.add(DomainMapper.shipmentToDomain(s, o, d));
            }
            List<Aeropuerto> aeropuertos = new ArrayList<>(aeropuertosByIcao.values());

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

            // --- Loop de épocas contra el reloj ---
            List<Envio> pendientes = new ArrayList<>();
            int totalAsignados = 0;

            for (EpocaData epoca : epocas) {
                if (cancelado.get()) {
                    emitir(topic, SimulationEventResponse.builder()
                            .tipo("FIN").runId(runId).mensaje("Simulación cancelada por el usuario.")
                            .totalAsignadosAcumulado(totalAsignados)
                            .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                            .build());
                    return;
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

                pendientes = simuladorEpocas.finalizarEpoca(epoca, mejor);

                List<RutaDTO> rutas = new ArrayList<>();
                if (mejor != null) {
                    totalAsignados += mejor.getEnviosAsignados().size();
                    mejor.getEnviosAsignados().forEach((envio, ruta) ->
                            rutas.add(RutaDTO.from(envio, ruta)));
                }

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
                        .ocupacionAlmacenes(ocupacionDe(epoca))
                        .totalAsignadosAcumulado(totalAsignados)
                        .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                        .build());

                dormir(pausaMsPorEpoca, cancelado);
            }

            emitir(topic, SimulationEventResponse.builder()
                    .tipo("FIN").runId(runId)
                    .totalEpocas(epocas.size())
                    .totalAsignadosAcumulado(totalAsignados)
                    .costoAcumulado(simuladorEpocas.getCostoAcumulado())
                    .mensaje(String.format("Simulación finalizada: %d asignados, %d pendientes.",
                            totalAsignados, pendientes.size()))
                    .build());

        } catch (Exception ex) {
            log.error("Simulación en vivo {} falló", runId, ex);
            emitir(topic, SimulationEventResponse.builder()
                    .tipo("ERROR").runId(runId)
                    .mensaje("Error: " + (ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage()))
                    .build());
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

    private Map<String, Double> ocupacionDe(EpocaData epoca) {
        Map<String, Double> ocup = new HashMap<>();
        if (epoca.getEstadoAlmacenes() != null) {
            for (Map.Entry<String, AlmacenEstado> e : epoca.getEstadoAlmacenes().entrySet()) {
                ocup.put(e.getKey(), e.getValue().getNivelOcupacion() * 100);
            }
        }
        return ocup;
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
}
