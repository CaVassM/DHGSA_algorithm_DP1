package com.TasfB2B.DHGS.demo.application.dto;

import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * DTO de entrada para ejecutar la optimización DHGS.
 */
@Getter
@Setter
public class OptimizationRequest {

    /** Ruta al archivo de aeropuertos (estudiantes.txt) */
    private String archivoAeropuertos;

    /** Ruta al archivo de vuelos (planes_vuelo.txt) */
    private String archivoVuelos;

    /** Rutas a los archivos de envíos (envios_*.txt) */
    private List<String> archivosEnvios;

    /** Duración de cada época en horas (default: 4) */
    private long duracionEpocaHoras = 4;

    /** Tamaño de la población genética (default: 25) */
    private int tamanoPoblacion = 25;

    /** Límite de tiempo por época en segundos (default: 300 = 5 minutos) */
    private int limiteTiempoSegundos = 300;
}

