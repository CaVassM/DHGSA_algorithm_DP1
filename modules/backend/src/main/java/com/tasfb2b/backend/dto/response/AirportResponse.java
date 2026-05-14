package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.model.AirportEntity;

public record AirportResponse(
        Long id,
        Integer idNegocio,
        String codigoIcao,
        String ciudad,
        String pais,
        String continente,
        Integer capacidadAlmacen,
        Double latitud,
        Double longitud,
        Integer gmt
) {
    public static AirportResponse fromEntity(AirportEntity entity) {
        return new AirportResponse(
                entity.getId(),
                entity.getIdNegocio(),
                entity.getCodigoIcao(),
                entity.getCiudad(),
                entity.getPais(),
                entity.getContinente(),
                entity.getCapacidadAlmacen(),
                entity.getLatitud(),
                entity.getLongitud(),
                entity.getGmt()
        );
    }
}
