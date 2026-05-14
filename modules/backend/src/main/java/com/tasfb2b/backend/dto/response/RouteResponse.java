package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.model.RouteEntity;

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
        List<String> flightBusinessIds
) {
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
                entity.getLegs().stream().map(leg -> leg.getFlight().getBusinessId()).toList()
        );
    }
}
