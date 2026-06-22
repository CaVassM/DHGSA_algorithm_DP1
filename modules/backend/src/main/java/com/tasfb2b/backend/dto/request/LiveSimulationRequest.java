package com.tasfb2b.backend.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * Petición para arrancar una simulación de periodo EN VIVO (con salto de
 * algoritmo). Los eventos de progreso se reciben por WebSocket en
 * {@code /topic/simulacion/{runId}}.
 */
@Data
public class LiveSimulationRequest {

    /** "DHGS" o "IALNS". Por defecto DHGS. */
    private String algorithm;

    /** Inicio de la simulación; si es null se infiere del primer envío. */
    private LocalDateTime planningStart;

    @Min(1) @Max(24)
    private long epochHours = 4;

    @Min(1) @Max(14)
    private long horizonDays = 5;

    @Min(1)
    private int populationSize = 6;

    @Min(1)
    private int timeLimitSeconds = 2;

    /**
     * Multiplicador temporal: cuántos minutos simulados pasan por minuto real.
     * Controla la velocidad de la animación (el "salto de consumo").
     * Mayor = más rápido. Típicos: 60, 120, 240.
     */
    @Min(1) @Max(100000)
    private int multiplicadorTemporal = 240;

    /** Pre-buffer: emitir un bloque por adelantado para evitar lag (reservado). */
    private boolean preBuffer = true;
}
