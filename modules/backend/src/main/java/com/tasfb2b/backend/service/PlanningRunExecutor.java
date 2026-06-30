package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.enums.DataSetReference;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.domain.enums.PlanningRunStatus;
import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.domain.model.PlanningRunEntity;
import com.tasfb2b.backend.domain.model.RouteEntity;
import com.tasfb2b.backend.domain.model.RouteLegEntity;
import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
import com.tasfb2b.backend.repository.PlanningRunRepository;
import com.tasfb2b.backend.repository.RouteRepository;
import com.tasfb2b.backend.repository.ShipmentRepository;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationOutcome;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationRequest;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationResponse;
import com.tasfb2b.dhgs.demo.application.service.OptimizationService;
import com.tasfb2b.dhgs.demo.application.service.OptimizationService.ExecutionParams;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Ejecutor asíncrono de corridas de planificación.
 *
 * Está en una clase separada de {@link PlanningService} para evitar la trampa
 * de Spring AOP self-invocation: llamar a un método {@code @Async} de la misma
 * clase salta el proxy y el método corre síncrono.
 */
@Service
@RequiredArgsConstructor
public class PlanningRunExecutor {

    private static final Logger log = LoggerFactory.getLogger(PlanningRunExecutor.class);

    private final OptimizationService optimizationService;
    private final PlanningRunRepository planningRunRepository;
    private final RouteRepository routeRepository;
    private final AirportRepository airportRepository;
    private final FlightRepository flightRepository;
    private final ShipmentRepository shipmentRepository;
    private final org.springframework.messaging.simp.SimpMessagingTemplate messaging;

    @Value("${planner.defaults.epoch-hours:4}")
    private long defaultEpochHours;

    @Value("${planner.defaults.population-size:6}")
    private int defaultPopulationSize;

    @Value("${planner.defaults.time-limit-seconds:2}")
    private int defaultTimeLimitSeconds;

    @Value("${planner.datasets.demo.aeropuertos:src/test/resources/datos/estudiantes.txt}")
    private String demoAeropuertos;

    @Value("${planner.datasets.demo.vuelos:src/test/resources/datos/planes_vuelo.txt}")
    private String demoVuelos;

    @Value("${planner.datasets.demo.envios-dir:src/test/resources/datos/envios_preliminar_test}")
    private String demoEnviosDir;

    @Value("${planner.datasets.real.aeropuertos:src/test/resources/datos/estudiantes_real.txt}")
    private String realAeropuertos;

    @Value("${planner.datasets.real.vuelos:src/test/resources/datos/planes_vuelo_real.txt}")
    private String realVuelos;

    @Value("${planner.datasets.real.envios-dir:src/test/resources/datos/envios_preliminar}")
    private String realEnviosDir;

    /**
     * Ejecuta la corrida en background. Cualquier excepción no controlada se
     * captura y se traduce a {@code status=FAILED} en la entidad — nunca dejar
     * el run en {@code RUNNING} para siempre.
     */
    @Async("planningExecutor")
    @Transactional
    public void executeRun(Long runId,
                           PlanningRequest request,
                           PlannerAlgorithm algorithm,
                           DataSetReference reference) {
        log.info("Iniciando run async {} con algoritmo {} y dataset {}", runId, algorithm, reference);
        try {
            OptimizationOutcome outcome = reference == DataSetReference.DB
                    ? runWithDatabase(request, algorithm)
                    : runWithFiles(request, algorithm, reference);

            PlanningRunEntity run = planningRunRepository.findById(runId)
                    .orElseThrow(() -> new IllegalStateException("Run " + runId + " desaparecido durante ejecución"));
            persistOutcome(run, outcome);
            log.info("Run {} finalizado con status {}", runId, run.getStatus());
            // T62: empujar el estado final del run a los navegadores suscritos.
            notificarEstadoRun(run);
        } catch (Exception ex) {
            log.error("Run async {} falló", runId, ex);
            planningRunRepository.findById(runId).ifPresent(run -> {
                run.setStatus(PlanningRunStatus.FAILED);
                run.setFinishedAt(LocalDateTime.now());
                run.setMensaje("Error: " + (ex.getMessage() == null ? ex.getClass().getSimpleName() : ex.getMessage()));
                planningRunRepository.save(run);
                notificarEstadoRun(run);
            });
        }
    }

    /** T62: publica el estado del run en /topic/run/{id} para el Dashboard. */
    private void notificarEstadoRun(PlanningRunEntity run) {
        try {
            messaging.convertAndSend("/topic/run/" + run.getId(),
                    com.tasfb2b.backend.dto.response.PlanningRunResponse.fromEntity(run));
        } catch (Exception e) {
            log.warn("No se pudo notificar el estado del run {} por WebSocket: {}", run.getId(), e.getMessage());
        }
    }

    private OptimizationOutcome runWithFiles(PlanningRequest request,
                                             PlannerAlgorithm algorithm,
                                             DataSetReference reference) {
        PlanningDataset dataset = resolveFileDataset(reference);
        OptimizationRequest opRequest = OptimizationRequest.of(
                mapAlgorithm(algorithm),
                dataset.aeropuertos().toString(),
                dataset.vuelos().toString(),
                loadShipmentFiles(dataset.enviosDir()),
                request.getEpochHours() != null ? request.getEpochHours() : defaultEpochHours,
                request.getHorizonDays() != null ? request.getHorizonDays() : 1,
                request.getPlanningStart(),
                request.getPopulationSize() != null ? request.getPopulationSize() : defaultPopulationSize,
                request.getTimeLimitSeconds() != null ? request.getTimeLimitSeconds() : defaultTimeLimitSeconds
        );
        return optimizationService.ejecutarConOutcome(opRequest);
    }

    private OptimizationOutcome runWithDatabase(PlanningRequest request, PlannerAlgorithm algorithm) {
        List<AirportEntity> airportEntities = airportRepository.findAll();
        if (airportEntities.isEmpty()) {
            throw new IllegalStateException(
                    "No hay aeropuertos en la BD. Usa /api/v1/admin/imports/airports antes de correr el planner con dataSetReference=DB.");
        }
        Map<String, Aeropuerto> aeropuertosByIcao = new HashMap<>();
        for (AirportEntity e : airportEntities) {
            aeropuertosByIcao.put(e.getCodigoIcao(), DomainMapper.airportToDomain(e));
        }

        List<Vuelo> vuelos = new ArrayList<>();
        for (FlightEntity f : flightRepository.findAll()) {
            Aeropuerto origen = aeropuertosByIcao.get(f.getAeropuertoOrigen().getCodigoIcao());
            Aeropuerto destino = aeropuertosByIcao.get(f.getAeropuertoDestino().getCodigoIcao());
            if (origen == null || destino == null) continue;
            vuelos.add(DomainMapper.flightToDomain(f, origen, destino));
        }

        List<Envio> envios = new ArrayList<>();
        for (ShipmentEntity s : shipmentRepository.findAll()) {
            Aeropuerto origen = aeropuertosByIcao.get(s.getAeropuertoOrigen().getCodigoIcao());
            Aeropuerto destino = aeropuertosByIcao.get(s.getAeropuertoDestino().getCodigoIcao());
            if (origen == null || destino == null) continue;
            envios.add(DomainMapper.shipmentToDomain(s, origen, destino));
        }

        ExecutionParams params = new ExecutionParams(
                mapAlgorithm(algorithm),
                request.getPlanningStart(),
                request.getEpochHours() != null ? request.getEpochHours() : defaultEpochHours,
                request.getHorizonDays() != null ? request.getHorizonDays() : 1,
                request.getPopulationSize() != null ? request.getPopulationSize() : defaultPopulationSize,
                request.getTimeLimitSeconds() != null ? request.getTimeLimitSeconds() : defaultTimeLimitSeconds
        );
        return optimizationService.ejecutarSobreDatos(
                new ArrayList<>(aeropuertosByIcao.values()), vuelos, envios, params);
    }

private void persistOutcome(PlanningRunEntity run, OptimizationOutcome outcome) {
    OptimizationResponse op = outcome.response();

    boolean failed = !op.isSimulacionCompleta()
            && outcome.rutasPorShipmentId().isEmpty();

    PlanningRunStatus status = failed
            ? PlanningRunStatus.FAILED
            : (op.isSimulacionCompleta()
                ? PlanningRunStatus.COMPLETED
                : PlanningRunStatus.COMPLETED_WITH_PENDING_SHIPMENTS);

    run.setStatus(status);
    run.setFinishedAt(LocalDateTime.now());
    run.setCostoTotal(op.getCostoTotal());
    run.setTotalEnviosAsignados(op.getTotalEnviosAsignados());
    run.setTotalEnviosNoAsignados(op.getTotalEnviosNoAsignados());
    run.setTotalMaletasDespachadas(op.getTotalMaletasDespachadas());
    run.setMensaje(op.getMensaje());

    planningRunRepository.save(run);

    Map<Long, ShipmentEntity> shipmentById = new HashMap<>();
    Map<String, FlightEntity> flightByBusinessId = new HashMap<>();

    log.info("Cantidad de rutas recibidas en outcome: {}", outcome.rutasPorShipmentId().size());

    for (Map.Entry<Long, RutaEnvio> entry : outcome.rutasPorShipmentId().entrySet()) {
        Long shipmentId = entry.getKey();
        RutaEnvio ruta = entry.getValue();

        log.info("Intentando guardar ruta para shipmentId {}", shipmentId);

        if (shipmentId == null) {
            log.warn("No se guardó ruta: shipmentId null");
            continue;
        }

        if (ruta == null) {
            log.warn("Ruta null para shipmentId {}", shipmentId);
            continue;
        }

        ShipmentEntity shipment = shipmentById.computeIfAbsent(
                shipmentId,
                id -> shipmentRepository.findById(id).orElse(null)
        );

        if (shipment == null) {
            log.warn("No se guardó ruta: no existe ShipmentEntity con id={}", shipmentId);
            continue;
        }

        RouteEntity route = RouteEntity.builder()
                .planningRun(run)
                .shipment(shipment)
                .tiempoInicio(ruta.getTiempoInicio())
                .tiempoLlegadaEstimado(ruta.getTiempoLlegadaEstimado())
                .distanciaTotal(ruta.getDistanciaTotal())
                .esDirecta(ruta.isEsDirecta())
                .escalas(ruta.getEscalas())
                .legs(new ArrayList<>())
                .build();

        List<Vuelo> secuencia = ruta.getSecuenciaVuelos();

        log.info(
                "Ruta para shipmentId {} tiene {} vuelos",
                shipmentId,
                secuencia == null ? 0 : secuencia.size()
        );

        if (secuencia != null) {
            for (int i = 0; i < secuencia.size(); i++) {
                Vuelo vuelo = secuencia.get(i);
                String fid = vuelo.getId();

                String flightBusinessId = fid != null && fid.contains("@")
                        ? fid.substring(0, fid.indexOf("@"))
                        : fid;

                FlightEntity flightEntity = flightByBusinessId.computeIfAbsent(
                        flightBusinessId,
                        bid -> flightRepository.findByBusinessId(bid).orElse(null)
                );

                if (flightEntity == null) {
                    log.warn("No se guardó leg: no existe FlightEntity con businessId={}", fid);
                    continue;
                }

                route.getLegs().add(RouteLegEntity.builder()
                        .route(route)
                        .flight(flightEntity)
                        .legOrder(i)
                        .build());
            }
        }

        routeRepository.save(route);

        log.info(
                "Ruta guardada para shipmentId {} con {} legs",
                shipmentId,
                route.getLegs().size()
        );
    }
}    
    
    
//    private void persistOutcome(PlanningRunEntity run, OptimizationOutcome outcome) {
//        OptimizationResponse op = outcome.response();
//        boolean failed = !op.isSimulacionCompleta() && outcome.rutasPorEnvioId().isEmpty();
//        PlanningRunStatus status = failed
//                ? PlanningRunStatus.FAILED
//                : (op.isSimulacionCompleta()
//                    ? PlanningRunStatus.COMPLETED
//                    : PlanningRunStatus.COMPLETED_WITH_PENDING_SHIPMENTS);
//
//        run.setStatus(status);
//        run.setFinishedAt(LocalDateTime.now());
//        run.setCostoTotal(op.getCostoTotal());
//        run.setTotalEnviosAsignados(op.getTotalEnviosAsignados());
//        run.setTotalEnviosNoAsignados(op.getTotalEnviosNoAsignados());
//        run.setTotalMaletasDespachadas(op.getTotalMaletasDespachadas());
//        run.setMensaje(op.getMensaje());
//        planningRunRepository.save(run);
//
//        Map<String, ShipmentEntity> shipmentByBusinessId = new HashMap<>();
//        Map<String, FlightEntity> flightByBusinessId = new HashMap<>();
//        log.info("Cantidad de rutas recibidas en outcome: {}", outcome.rutasPorEnvioId().size());
//        for (Map.Entry<String, RutaEnvio> entry : outcome.rutasPorEnvioId().entrySet()) {
//            String envioBusinessId = entry.getKey();
//            RutaEnvio ruta = entry.getValue();
//            log.info("Intentando guardar ruta para envío {}", envioBusinessId);
//              if (ruta == null) {
//                    log.warn("Ruta null para envío {}", envioBusinessId);
//                    continue;
//                }
//             
//                    
//            ShipmentEntity shipment = shipmentByBusinessId.computeIfAbsent(envioBusinessId,
//                    id -> shipmentRepository.findByBusinessId(id).orElse(null));
//            if (shipment == null) {
//                log.warn("No se guardó ruta: no existe ShipmentEntity con businessId={}", envioBusinessId);
//                continue;
//            }
//
//            RouteEntity route = RouteEntity.builder()
//                    .planningRun(run)
//                    .shipment(shipment)
//                    .tiempoInicio(ruta.getTiempoInicio())
//                    .tiempoLlegadaEstimado(ruta.getTiempoLlegadaEstimado())
//                    .distanciaTotal(ruta.getDistanciaTotal())
//                    .esDirecta(ruta.isEsDirecta())
//                    .escalas(ruta.getEscalas())
//                    .legs(new ArrayList<>())
//                    .build();
//
//            List<Vuelo> secuencia = ruta.getSecuenciaVuelos();
//            log.info("Ruta para envío {} tiene {} vuelos",envioBusinessId,secuencia == null ? 0 : secuencia.size());
//            if (secuencia != null) {
//                for (int i = 0; i < secuencia.size(); i++) {
//                    Vuelo vuelo = secuencia.get(i);
//                    String fid = vuelo.getId();
//                    
//                    String flightBusinessId = fid != null && fid.contains("@")
//                            ? fid.substring(0, fid.indexOf("@"))
//                            : fid;
//                    /*FlightEntity flightEntity = flightByBusinessId.computeIfAbsent(fid,
//                            bid -> flightRepository.findByBusinessId(bid).orElse(null));*/
//                    FlightEntity flightEntity = flightByBusinessId.computeIfAbsent(flightBusinessId,
//                            bid -> flightRepository.findByBusinessId(bid).orElse(null));
//                    if (flightEntity == null) {
//                        log.warn("No se guardó leg: no existe FlightEntity con businessId={}", fid);
//                        continue;
//                    }
//                    route.getLegs().add(RouteLegEntity.builder()
//                            .route(route)
//                            .flight(flightEntity)
//                            .legOrder(i)
//                            .build());
//                }
//            }
//            routeRepository.save(route);
//            log.info("Ruta guardada para envío {} con {} legs",
//            envioBusinessId,
//            route.getLegs().size());
//        }
//    }

    private OptimizationAlgorithm mapAlgorithm(PlannerAlgorithm algorithm) {
        return algorithm == PlannerAlgorithm.DHGS ? OptimizationAlgorithm.DHGS : OptimizationAlgorithm.IALNS;
    }

    private PlanningDataset resolveFileDataset(DataSetReference reference) {
        return switch (reference) {
            case DEMO, TEST -> new PlanningDataset(
                    resolvePath(demoAeropuertos), resolvePath(demoVuelos), resolvePath(demoEnviosDir));
            case REAL -> new PlanningDataset(
                    resolvePath(realAeropuertos), resolvePath(realVuelos), resolvePath(realEnviosDir));
            case DB -> throw new IllegalStateException(
                    "resolveFileDataset llamado con DB; ese caso debe haber tomado la rama de BD.");
        };
    }

    private Path resolvePath(String configuredPath) {
        List<Path> candidates = List.of(
                Paths.get(configuredPath),
                Paths.get("modules", "backend").resolve(configuredPath)
        );
        return candidates.stream()
                .map(Path::normalize)
                .filter(Files::exists)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No se encontró la ruta configurada: " + configuredPath));
    }

    private List<String> loadShipmentFiles(Path directory) {
        try (Stream<Path> stream = Files.list(directory)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".txt"))
                    .sorted(Comparator.comparing(p -> p.getFileName().toString()))
                    .map(p -> p.toAbsolutePath().normalize().toString())
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("No se pudieron leer los archivos de envíos en " + directory, e);
        }
    }

    private record PlanningDataset(Path aeropuertos, Path vuelos, Path enviosDir) {}
}
