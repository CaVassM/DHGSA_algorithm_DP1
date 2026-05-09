package com.tasfb2b.dhgs.demo.application.dto;

import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * DTO que representa la ruta asignada a un envío.
 */
@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class RutaDTO {

    private String envioId;
    private String origenICAO;
    private String destinoICAO;
    private int cantidadMaletas;
    private List<String> vuelos = new ArrayList<>();  // Ej: ["SKBO→SPIM 03:34", "SPIM→SCEL 08:00"]
    private double distanciaKm;
    private long retrasoMinutos;
    private boolean factible;
    private int escalas;

    public static RutaDTO from(Envio envio, RutaEnvio ruta) {
        RutaDTO dto = new RutaDTO();
        dto.envioId = envio.getId();
        dto.origenICAO = envio.getAeropuertoOrigen() != null ? envio.getAeropuertoOrigen().getCodigoICAO() : null;
        dto.destinoICAO = envio.getAeropuertoDestino() != null ? envio.getAeropuertoDestino().getCodigoICAO() : null;
        dto.cantidadMaletas = envio.getCantidadMaletas();

        if (ruta != null) {
            ruta.calcularTiempos();
            dto.distanciaKm = ruta.getDistanciaTotal();
            dto.retrasoMinutos = ruta.getRetraso();
            dto.factible = ruta.esFactible();
            dto.escalas = ruta.getEscalas();

            if (ruta.getSecuenciaVuelos() != null) {
                dto.vuelos = ruta.getSecuenciaVuelos().stream()
                        .map(RutaDTO::describirVuelo)
                        .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
            }
        }

        return dto;
    }

    private static String describirVuelo(Vuelo vuelo) {
        String origen = vuelo.getAeropuertoOrigen() != null ? vuelo.getAeropuertoOrigen().getCodigoICAO() : "N/A";
        String destino = vuelo.getAeropuertoDestino() != null ? vuelo.getAeropuertoDestino().getCodigoICAO() : "N/A";

        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraSalida() != null) {
            return origen + "→" + destino + " " + instancia.getFechaHoraSalida();
        }
        return origen + "→" + destino + " " + vuelo.getHoraSalida();
    }
}

