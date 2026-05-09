package com.tasfb2b.dhgs.demo.application.dto;

import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.List;

/**
 * DTO de entrada para ejecutar la optimización sobre el modelo operativo actual.
 */
@Getter
@Setter
public class OptimizationRequest {

    public static OptimizationRequest of(OptimizationAlgorithm algoritmo,
                                         String archivoAeropuertos,
                                         String archivoVuelos,
                                         List<String> archivosEnvios,
                                         long duracionEpocaHoras,
                                         long duracionSimulacionDias,
                                         LocalDateTime fechaInicioSimulacion,
                                         int tamanoPoblacion,
                                         int limiteTiempoSegundos) {
        OptimizationRequest request = new OptimizationRequest();
        request.algoritmo = algoritmo;
        request.archivoAeropuertos = archivoAeropuertos;
        request.archivoVuelos = archivoVuelos;
        request.archivosEnvios = archivosEnvios != null ? List.copyOf(archivosEnvios) : List.of();
        request.duracionEpocaHoras = duracionEpocaHoras;
        request.duracionSimulacionDias = duracionSimulacionDias;
        request.fechaInicioSimulacion = fechaInicioSimulacion;
        request.tamanoPoblacion = tamanoPoblacion;
        request.limiteTiempoSegundos = limiteTiempoSegundos;
        return request;
    }

    /** Algoritmo a ejecutar sobre el mismo modelo operacional (default: DHGS) */
    private OptimizationAlgorithm algoritmo = OptimizationAlgorithm.DHGS;

    /** Ruta al archivo de aeropuertos (estudiantes.txt) */
    private String archivoAeropuertos;

    /** Ruta al archivo de vuelos (planes_vuelo.txt) */
    private String archivoVuelos;

    /** Rutas a los archivos de envíos (envios_*.txt) */
    private List<String> archivosEnvios;

    /** Duración de cada época en horas (default: 4) */
    private long duracionEpocaHoras = 4;

    /** Duración total de la simulación en días (default: 5) */
    private long duracionSimulacionDias = 5;

    /**
     * Fecha/hora de inicio de la simulación.
     * Si no se especifica, el sistema inicia al comienzo del día anterior
     * al primer envío cargado.
     */
    private LocalDateTime fechaInicioSimulacion;

    /** Tamaño de la población genética (default: 25) */
    private int tamanoPoblacion = 25;

    /** Límite de tiempo por época en segundos (default: 300 = 5 minutos) */
    private int limiteTiempoSegundos = 300;
}

