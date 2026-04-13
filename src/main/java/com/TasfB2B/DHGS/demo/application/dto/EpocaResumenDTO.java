package com.TasfB2B.DHGS.demo.application.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.HashMap;
import java.util.Map;

/**
 * DTO con el resumen de una época de simulación.
 */
@Getter
@Setter
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
}

