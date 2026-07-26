/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
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
import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
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

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
@RequiredArgsConstructor
public class PlanningRoutePersistenceService {
    private static final Logger log = LoggerFactory.getLogger(PlanningRoutePersistenceService.class);
    private final PlanningRunRepository planningRunRepository;
    private final ShipmentRepository shipmentRepository;
    private final RouteRepository routeRepository;
    private final FlightRepository flightRepository;

    /**
     * Persiste las rutas de una época fuera del hilo que anima la simulación.
     *
     * <p>C29: escribir ~1.800 rutas con sus legs tarda más que la pausa entre
     * épocas, así que hacerlo en línea congelaba la reproducción. La detección
     * de colapso y los eventos WebSocket trabajan sobre el {@link Individuo} en
     * memoria, no sobre lo persistido, de modo que la animación puede seguir
     * mientras la BD se pone al día. El {@code runId} ya existe cuando esto se
     * invoca, y las escrituras de épocas sucesivas no se pisan porque el
     * ejecutor de Spring las procesa en orden de llegada.
     *
     * <p>Lleva su propio {@code @Transactional} en vez de delegar en
     * {@link #guardarRutasDeEpoca}: una llamada interna no pasa por el proxy de
     * Spring, así que la transacción del otro método no se activaría.
     */
    @Async("routePersistenceExecutor")
    @Transactional
    public void guardarRutasDeEpocaAsync(Long runId, int numeroEpoca, Individuo mejor) {
        try {
            persistir(runId, numeroEpoca, mejor);
        } catch (RuntimeException ex) {
            // Que falle el guardado no debe tumbar la simulación: la corrida es
            // lo que se está mostrando, y las rutas son el registro posterior.
            log.error("No se pudieron persistir las rutas de la época {} (runId={}): {}",
                    numeroEpoca, runId, ex.getMessage(), ex);
        }
    }

    /** Versión síncrona: el llamador espera a que las rutas estén en BD. */
    @Transactional
    public void guardarRutasDeEpoca(Long runId, int numeroEpoca, Individuo mejor) {
        persistir(runId, numeroEpoca, mejor);
    }

    private void persistir(Long runId, int numeroEpoca, Individuo mejor) {
        if (mejor == null || mejor.getEnviosAsignados() == null || mejor.getEnviosAsignados().isEmpty()) {
            log.info("No hay rutas para guardar en runId={}, epoca={}", runId, numeroEpoca);
            return;
        }

        PlanningRunEntity run = planningRunRepository.findById(runId)
                .orElseThrow(() -> new IllegalStateException("No existe PlanningRun con id=" + runId));

        // C29: los envíos y los vuelos de la época se traen en dos consultas, no
        // en una por fila. Antes buscarShipment() hacía un SELECT por envío
        // (~1.800 por época) y el hilo de la simulación se quedaba esperando a
        // Postgres en vez de animar.
        Map<String, ShipmentEntity> shipmentPorClave =
                cargarShipments(mejor.getEnviosAsignados().keySet());
        Map<String, FlightEntity> flightByBusinessId =
                cargarVuelos(mejor.getEnviosAsignados().values());
        List<RouteEntity> porGuardar = new ArrayList<>(mejor.getEnviosAsignados().size());

        for (Map.Entry<Envio, RutaEnvio> entry : mejor.getEnviosAsignados().entrySet()) {
            Envio envio = entry.getKey();
            RutaEnvio ruta = entry.getValue();

            if (envio == null) {
                log.warn("No se guardó ruta: envio null");
                continue;
            }

            if (ruta == null) {
                log.warn("No se guardó ruta para envio {}: ruta null", envio.getId());
                continue;
            }

            ShipmentEntity shipment = shipmentPorClave.get(claveShipment(envio));

//            if (shipmentId == null) {
//                log.warn("No se guardó ruta: no se pudo convertir envioId={} a shipmentId", envio.getId());
//                continue;
//            }

//            ShipmentEntity shipment = shipmentById.computeIfAbsent(
//                    shipmentId,
//                    id -> shipmentRepository.findById(id).orElse(null)
//            );

            if (shipment == null) {
                log.warn(
                        "No se guardó ruta: no existe ShipmentEntity con businessId={} y aeropuertoOrigenId={}",
                        envio.getId(),
                        envio.getAeropuertoOrigen() != null ? envio.getAeropuertoOrigen().getId() : null
                );
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

            if (secuencia != null) {
                for (int i = 0; i < secuencia.size(); i++) {
                    Vuelo vuelo = secuencia.get(i);

                    if (vuelo == null || vuelo.getId() == null) {
                        continue;
                    }

                    String flightBusinessId = businessIdDeVuelo(vuelo.getId());

                    FlightEntity flightEntity = flightByBusinessId.get(flightBusinessId);

                    if (flightEntity == null) {
                        log.warn("No se guardó leg: no existe FlightEntity con businessId={}", flightBusinessId);
                        continue;
                    }

                    route.getLegs().add(RouteLegEntity.builder()
                            .route(route)
                            .flight(flightEntity)
                            .legOrder(i)
                            .build());
                }
            }


            // C29: acumular y guardar en lote al final. Un save() por envío con
            // dos líneas de log cada uno hacía que una época de ~1.800 envíos
            // tardara más de un minuto en persistirse, y la reproducción se
            // quedaba congelada esperándola.
            porGuardar.add(route);
        }

        if (!porGuardar.isEmpty()) {
            routeRepository.saveAll(porGuardar);
            log.info("Época {}: {} rutas persistidas para runId={}",
                    numeroEpoca, porGuardar.size(), runId);
        }
    }

    private Long extraerShipmentId(String envioId) {
        if (envioId == null || envioId.isBlank()) {
            return null;
        }

        /*
         * En modo colapso tú creas ids como:
         *   123-C1
         *   123-C2
         *
         * Como esos envíos clonados no existen realmente en la tabla shipments,
         * tomamos la parte original antes de "-C".
         */
        String limpio = envioId;

        int idxCopia = limpio.indexOf("-C");
        if (idxCopia > 0) {
            limpio = limpio.substring(0, idxCopia);
        }

        try {
            return Long.valueOf(limpio);
        } catch (NumberFormatException ex) {
            return null;
        }
    }
    
    /**
     * Los envíos de la época indexados por {@link #claveShipment}, en una sola
     * consulta.
     *
     * <p>Un envío se identifica por (businessId, aeropuertoOrigen): el
     * businessId solo no basta, de ahí que la clave lleve ambos. La consulta
     * filtra por businessId — que es lo indexable — y el par se desempata aquí.
     */
    private Map<String, ShipmentEntity> cargarShipments(Collection<Envio> envios) {
        Set<String> businessIds = envios.stream()
                .filter(e -> e != null && e.getId() != null && !e.getId().isBlank())
                .map(e -> limpiarBusinessId(e.getId()))
                .collect(Collectors.toSet());

        if (businessIds.isEmpty()) {
            return Map.of();
        }

        Map<String, ShipmentEntity> porClave = new HashMap<>();
        for (ShipmentEntity s : shipmentRepository.findAllByBusinessIdIn(businessIds)) {
            Long origenId = s.getAeropuertoOrigen() != null ? s.getAeropuertoOrigen().getId() : null;
            porClave.put(s.getBusinessId() + "@" + origenId, s);
        }
        return porClave;
    }

    /** Los vuelos usados por las rutas de la época, en una sola consulta. */
    private Map<String, FlightEntity> cargarVuelos(Collection<RutaEnvio> rutas) {
        Set<String> businessIds = new HashSet<>();
        for (RutaEnvio ruta : rutas) {
            if (ruta == null || ruta.getSecuenciaVuelos() == null) {
                continue;
            }
            for (Vuelo vuelo : ruta.getSecuenciaVuelos()) {
                if (vuelo != null && vuelo.getId() != null) {
                    businessIds.add(businessIdDeVuelo(vuelo.getId()));
                }
            }
        }

        if (businessIds.isEmpty()) {
            return Map.of();
        }

        Map<String, FlightEntity> porBusinessId = new HashMap<>();
        for (FlightEntity f : flightRepository.findAllByBusinessIdIn(businessIds)) {
            porBusinessId.put(f.getBusinessId(), f);
        }
        return porBusinessId;
    }

    /**
     * Clave de un envío del dominio, para casarlo con su fila en shipments.
     * Debe construirse igual que en {@link #cargarShipments}.
     */
    private String claveShipment(Envio envio) {
        if (envio == null || envio.getId() == null || envio.getId().isBlank()) {
            return null;
        }
        Long origenId = envio.getAeropuertoOrigen() != null
                ? Long.valueOf(envio.getAeropuertoOrigen().getId())
                : null;
        return limpiarBusinessId(envio.getId()) + "@" + origenId;
    }

    /**
     * El id de plantilla de una instancia de vuelo. {@code GrafoVuelos} fecha
     * las instancias como {@code businessId@fecha}; en BD solo existe la
     * plantilla.
     */
    private String businessIdDeVuelo(String id) {
        int idx = id.indexOf("@");
        return idx > 0 ? id.substring(0, idx) : id;
    }
    
    
    private String limpiarBusinessId(String id) {
        if (id == null) {
            return null;
        }

        int idxCopia = id.indexOf("-C");
        if (idxCopia > 0) {
            return id.substring(0, idxCopia);
        }

        return id;
    }
//    private ShipmentEntity buscarShipment(Envio envio) {
//        try {
//            Long shipmentId = Long.valueOf(envio.getId());
//            return shipmentRepository.findById(shipmentId)
//                    .orElseThrow(() -> new IllegalStateException(
//                            "No existe ShipmentEntity con id " + envio.getId()));
//        } catch (NumberFormatException ex) {
//            throw new IllegalStateException(
//                    "El id del envío no es numérico: " + envio.getId()
//                            + ". Debes buscar el ShipmentEntity por código externo o campo equivalente.");
//        }
//    }
//
//    private void agregarLegs(RouteEntity route, RutaEnvio ruta) {
//        int order = 1;
//
//        for (Vuelo vuelo : ruta.getVuelos()) {
//            RouteLegEntity leg = RouteLegEntity.builder()
//                    .route(route)
//                    .legOrder(order++)
//                    .flightId(vuelo.getId())
//                    .origenIcao(vuelo.getAeropuertoOrigen().getCodigoIcao())
//                    .destinoIcao(vuelo.getAeropuertoDestino().getCodigoIcao())
//                    .tiempoSalida(vuelo.getFechaHoraSalida())
//                    .tiempoLlegada(vuelo.getFechaHoraLlegada())
//                    .build();
//
//            route.getLegs().add(leg);
//        }
//    }

}