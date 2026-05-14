package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.model.FlightEntity;

import java.time.LocalTime;

public record FlightResponse(
        Long id,
        String businessId,
        String origenIcao,
        String destinoIcao,
        LocalTime horaSalida,
        LocalTime horaLlegada,
        Integer capacidad,
        Integer capacidadDisponible,
        Double distancia,
        Long duracionMinutos
) {
    public static FlightResponse fromEntity(FlightEntity entity) {
        return new FlightResponse(
                entity.getId(),
                entity.getBusinessId(),
                entity.getAeropuertoOrigen().getCodigoIcao(),
                entity.getAeropuertoDestino().getCodigoIcao(),
                entity.getHoraSalida(),
                entity.getHoraLlegada(),
                entity.getCapacidad(),
                entity.getCapacidadDisponible(),
                entity.getDistancia(),
                entity.getDuracionMinutos()
        );
    }
}
