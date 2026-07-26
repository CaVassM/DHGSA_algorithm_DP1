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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

    @Transactional
    public void guardarRutasDeEpoca(Long runId, int numeroEpoca, Individuo mejor) {
        if (mejor == null || mejor.getEnviosAsignados() == null || mejor.getEnviosAsignados().isEmpty()) {
            log.info("No hay rutas para guardar en runId={}, epoca={}", runId, numeroEpoca);
            return;
        }

        PlanningRunEntity run = planningRunRepository.findById(runId)
                .orElseThrow(() -> new IllegalStateException("No existe PlanningRun con id=" + runId));

        Map<Long, ShipmentEntity> shipmentById = new HashMap<>();
        Map<String, FlightEntity> flightByBusinessId = new HashMap<>();

        log.info(
                "Guardando {} rutas para runId={}, epoca={}",
                mejor.getEnviosAsignados().size(),
                runId,
                numeroEpoca
        );

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

            ShipmentEntity shipment = buscarShipment(envio);

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

            log.info(
                    "Ruta para shipmentId={} tiene {} vuelos",
                    envio.getId(),
                    secuencia == null ? 0 : secuencia.size()
            );

            if (secuencia != null) {
                for (int i = 0; i < secuencia.size(); i++) {
                    Vuelo vuelo = secuencia.get(i);

                    if (vuelo == null || vuelo.getId() == null) {
                        continue;
                    }

                    String fid = vuelo.getId();

                    String flightBusinessId = fid.contains("@")
                            ? fid.substring(0, fid.indexOf("@"))
                            : fid;

                    FlightEntity flightEntity = flightByBusinessId.computeIfAbsent(
                            flightBusinessId,
                            bid -> flightRepository.findByBusinessId(bid).orElse(null)
                    );

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


            routeRepository.save(route);

            log.info(
                "Ruta guardada para envio={} con {} legs",
                envio.getId(),
                route.getLegs().size()
            );
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
    
    private ShipmentEntity buscarShipment(Envio envio) {
        if (envio == null || envio.getId() == null || envio.getId().isBlank()) {
            return null;
        }

        String businessId = limpiarBusinessId(envio.getId());

        if (envio.getAeropuertoOrigen() == null) {
            log.warn(
                    "No se pudo buscar ShipmentEntity: envio={} no tiene aeropuerto origen o id de aeropuerto",
                    businessId
            );
            return null;
        }

        Long aeropuertoOrigenId = Long.valueOf(envio.getAeropuertoOrigen().getId());

        return shipmentRepository
                .findByBusinessIdAndAeropuertoOrigen_Id(businessId, aeropuertoOrigenId)
                .orElse(null);
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