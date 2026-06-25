package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Reporte final de una simulación de colapso (escenario COLLAPSE_SIMULATION).
 *
 * Se incluye dentro del evento WebSocket de tipo "COLAPSO" (o "FIN" si no se
 * llegó a colapsar) y resume qué pasó: cuándo colapsó el sistema, cuánta carga
 * quedó sin atender y qué aeropuertos se saturaron primero.
 */
@Data
@Builder
public class CollapseReportResponse {

    /** true si se alcanzó el colapso; false si terminó sin colapsar. */
    private boolean colapso;

    /** Factor por el que se multiplicó la carga original. */
    private int factorCarga;

    /** Época y momento simulado en que se detectó el colapso (null si no colapsó). */
    private Integer epocaColapso;
    private LocalDateTime momentoColapso;

    /** Motivo del colapso (texto legible). */
    private String motivo;

    // --- Cifras del colapso ---
    private int totalEnviosCargados;
    private int totalAsignados;
    private int totalSinAtender;
    private double porcentajeSinAtender;

    /** Ocupación final por aeropuerto (ICAO -> %), ordenable para ver cuellos. */
    private Map<String, Double> ocupacionFinal;

    /** Aeropuertos que se saturaron (>= umbral), del más lleno al menos. */
    private List<String> aeropuertosSaturados;
}
