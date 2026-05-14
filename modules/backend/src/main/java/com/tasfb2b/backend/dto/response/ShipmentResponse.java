package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.model.ShipmentEntity;

import java.time.LocalDateTime;

public record ShipmentResponse(
        Long id,
        String businessId,
        String origenIcao,
        String destinoIcao,
        LocalDateTime fechaHoraCreacion,
        Integer cantidadMaletas,
        String idCliente,
        LocalDateTime deadline,
        boolean esMustGo,
        Integer prioridad
) {
    public static ShipmentResponse fromEntity(ShipmentEntity entity) {
        return new ShipmentResponse(
                entity.getId(),
                entity.getBusinessId(),
                entity.getAeropuertoOrigen().getCodigoIcao(),
                entity.getAeropuertoDestino().getCodigoIcao(),
                entity.getFechaHoraCreacion(),
                entity.getCantidadMaletas(),
                entity.getIdCliente(),
                entity.getDeadline(),
                entity.isEsMustGo(),
                entity.getPrioridad()
        );
    }
}
