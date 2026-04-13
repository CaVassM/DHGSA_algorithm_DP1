package com.TasfB2B.DHGS.demo.application.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * DTO que representa la ruta asignada a un envío.
 */
@Getter
@Setter
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
}

