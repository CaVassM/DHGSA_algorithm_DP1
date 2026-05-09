package com.tasfb2b.dhgs.demo.application.dto;

import com.tasfb2b.dhgs.demo.domain.service.EpocaData;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.HashMap;
import java.util.Map;

/**
 * DTO con el resumen de una época de simulación.
 */
@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class EpocaResumenDTO {

    private int numeroEpoca;
    private int enviosNuevos;
    private int enviosPendientes;
    private int enviosDespachados;
    private int enviosPostpuestos;
    private long mustGo;
    private int maletasTotales;
    private double costoEpoca;
    private boolean procesada;
    private Map<String, Double> ocupacionAlmacenes = new HashMap<>();  // ICAO → % ocupación

    public static EpocaResumenDTO from(EpocaData epoca) {
        EpocaResumenDTO dto = new EpocaResumenDTO();
        dto.numeroEpoca = epoca.getNumeroEpoca();
        dto.enviosNuevos = epoca.getEnviosNuevos() != null ? epoca.getEnviosNuevos().size() : 0;
        dto.enviosPendientes = epoca.getEnviosPendientes() != null ? epoca.getEnviosPendientes().size() : 0;
        dto.enviosDespachados = epoca.getEnviosDespachados() != null ? epoca.getEnviosDespachados().size() : 0;
        dto.enviosPostpuestos = epoca.getEnviosPostpuestos() != null ? epoca.getEnviosPostpuestos().size() : 0;
        dto.mustGo = epoca.contarMustGo();
        dto.maletasTotales = epoca.contarMaletasTotales();
        dto.costoEpoca = epoca.getCostoEpoca();
        dto.procesada = epoca.isProcesada();

        if (epoca.getEstadoAlmacenes() != null) {
            epoca.getEstadoAlmacenes().forEach((icao, estado) ->
                    dto.ocupacionAlmacenes.put(icao, estado.getNivelOcupacion() * 100));
        }

        return dto;
    }
}

