package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

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
    }
}
