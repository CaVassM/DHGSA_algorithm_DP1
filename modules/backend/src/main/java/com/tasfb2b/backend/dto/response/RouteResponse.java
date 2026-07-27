package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.model.RouteEntity;
import com.tasfb2b.backend.domain.model.RouteLegEntity;

import java.time.LocalDateTime;
import java.util.List;

public record RouteResponse(
        Long id,
        Long planningRunId,
        String shipmentBusinessId,
        String origenIcao,
        String destinoIcao,
        Integer cantidadMaletas,
        LocalDateTime tiempoInicio,
        LocalDateTime tiempoLlegadaEstimado,
        Double distanciaTotal,
        boolean esDirecta,
        Integer escalas,
        List<String> flightBusinessIds,
        /**
         * Tramos con la hora real (UTC) de salida y llegada de la instancia de
         * vuelo que el algoritmo asignó, en el mismo orden que
         * {@link #flightBusinessIds}. Con esto el frontend ya no necesita
         * reconstruir el horario de cada tramo a partir de la plantilla: puede
         * ser {@code null}/vacío en rutas persistidas antes de este campo.
         */
        List<LegResponse> legs
) {
    public record LegResponse(
            String flightBusinessId,
            LocalDateTime salidaUtc,
            LocalDateTime llegadaUtc
    ) {
        public static LegResponse fromEntity(RouteLegEntity leg) {
            return new LegResponse(
                    leg.getFlight().getBusinessId(),
                    leg.getSalidaUtc(),
                    leg.getLlegadaUtc()
            );
        }
    }

    public static RouteResponse fromEntity(RouteEntity entity) {
        return new RouteResponse(
                entity.getId(),
                entity.getPlanningRun().getId(),
                entity.getShipment().getBusinessId(),
                entity.getShipment().getAeropuertoOrigen().getCodigoIcao(),
                entity.getShipment().getAeropuertoDestino().getCodigoIcao(),
                entity.getShipment().getCantidadMaletas(),
                entity.getTiempoInicio(),
                entity.getTiempoLlegadaEstimado(),
                entity.getDistanciaTotal(),
                entity.isEsDirecta(),
                entity.getEscalas(),
                entity.getLegs().stream().map(leg -> leg.getFlight().getBusinessId()).toList(),
                entity.getLegs().stream().map(LegResponse::fromEntity).toList()
        );
    }
}
