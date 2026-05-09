package com.tasfb2b.dhgs.demo.application.dto;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.ArrayList;
import java.util.List;

/**
 * DTO de respuesta con los resultados de la optimización ejecutada.
 */
@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class OptimizationResponse {

    public static OptimizationResponse started(OptimizationAlgorithm algoritmoEjecutado) {
        OptimizationResponse response = new OptimizationResponse();
        response.algoritmoEjecutado = algoritmoEjecutado;
        return response;
    }

    private OptimizationAlgorithm algoritmoEjecutado;
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

    public void markTotalEpocas(int totalEpocas) {
        this.totalEpocas = totalEpocas;
    }

    public void addResumenEpoca(EpocaResumenDTO resumenEpoca) {
        this.resumenPorEpoca.add(resumenEpoca);
    }

    public void complete(int epocasProcesadas,
                         double costoTotal,
                         int totalEnviosAsignados,
                         int totalEnviosNoAsignados,
                         int totalMaletasDespachadas,
                         boolean simulacionCompleta,
                         List<RutaDTO> mejoresRutas,
                         String mensaje) {
        this.epocasProcesadas = epocasProcesadas;
        this.costoTotal = costoTotal;
        this.totalEnviosAsignados = totalEnviosAsignados;
        this.totalEnviosNoAsignados = totalEnviosNoAsignados;
        this.totalMaletasDespachadas = totalMaletasDespachadas;
        this.simulacionCompleta = simulacionCompleta;
        this.mejoresRutas = mejoresRutas != null ? new ArrayList<>(mejoresRutas) : new ArrayList<>();
        this.mensaje = mensaje;
    }

    public void markError(String mensaje) {
        this.mensaje = mensaje;
        this.simulacionCompleta = false;
    }

    public void finish(long tiempoEjecucionMs) {
        this.tiempoEjecucionMs = tiempoEjecucionMs;
    }
}

