package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Estado actual de la operación día a día: cómo se van llenando las capacidades
 * de los vuelos en línea conforme se registran envíos. Sirve para visualizar el
 * avance hacia el colapso (cuando ya no entra carga en ninguna ruta).
 */
@Data
@Builder
public class DailyStateResponse {

    private int totalRegistrados;
    private int totalAceptados;
    private int totalRechazados;
    private int totalMaletasDespachadas;

    /** Porcentaje global de ocupación de la flota (0-100). */
    private double ocupacionFlotaPorcentaje;

    /** true cuando ningún vuelo admite más carga (colapso total). */
    private boolean colapsoTotal;

    private List<FlightLoad> vuelos;

    /**
     * Capacidad de almacén de las cuatro sedes de la prueba.
     *
     * <p>La preparación del escenario las sube a 999 y eso hay que poder
     * enseñarlo: el enunciado lo pide como parte de la fase de preparación. Sin
     * esto no aparecía en ninguna pantalla — la tabla de vuelos muestra la
     * capacidad de cada VUELO (300-360), que es otra cosa.
     */
    private List<WarehouseCapacity> almacenes;

    @Data
    @Builder
    public static class WarehouseCapacity {
        private String icao;
        private String ciudad;
        private int capacidad;
        /** true si está en el valor que la prueba exige (999). */
        private boolean preparado;
    }

    @Data
    @Builder
    public static class FlightLoad {
        private String vueloId;
        private String origenIcao;
        private String destinoIcao;
        private int capacidad;
        private int capacidadDisponible;
        private int ocupado;
        private double ocupacionPorcentaje;

        /** Salida/llegada en UTC real, para saber si esta salida ya está en el aire. */
        private LocalDateTime salidaUtc;
        private LocalDateTime llegadaUtc;

        /** Las mismas, en la hora de pared de cada aeropuerto (para mostrarlas). */
        private LocalDateTime salidaLocal;
        private LocalDateTime llegadaLocal;

        private String gmtOrigen;
        private String gmtDestino;

        /** true si esta salida fue cancelada (P&R P9). */
        private boolean cancelado;
    }
}