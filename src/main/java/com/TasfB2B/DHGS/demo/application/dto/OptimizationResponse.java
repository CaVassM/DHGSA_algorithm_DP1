package com.TasfB2B.DHGS.demo.application.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * DTO de respuesta con los resultados de la optimización DHGS.
 */
@Getter
@Setter
public class OptimizationResponse {

    private int totalEpocas;
    private int epocasProcesadas;
    private double costoTotal;
    private int totalEnviosAsignados;
    private int totalEnviosNoAsignados;
    private int totalMaletasDespachadas;
    private boolean simulacionCompleta;
    private List<EpocaResumenDTO> resumenPorEpoca = new ArrayList<>();
    private List<RutaDTO> mejoresRutas = new ArrayList<>();
    private String mensaje;
    private long tiempoEjecucionMs;
}

