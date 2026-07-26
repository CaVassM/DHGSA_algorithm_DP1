package com.tasfb2b.backend.dto.response;

import com.tasfb2b.dhgs.demo.application.dto.RutaDTO;
import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * Evento emitido por WebSocket en cada paso ("salto") de la simulación de
 * periodo en vivo. Representa el estado de UNA época ya procesada, para que el
 * mapa anime el avance: rutas despachadas, ocupación de almacenes y métricas
 * acumuladas hasta ese momento.
 *
 * Se publica en {@code /topic/simulacion/{runId}}.
 */
@Data
@Builder
public class SimulationEventResponse {

    /** Tipo de evento: INICIO, EPOCA, CANCELACION, COLAPSO, FIN, ERROR. */
    private String tipo;

    private Long runId;

    /** Número de época actual y total (para la barra de progreso). */
    private int numeroEpoca;
    private int totalEpocas;

    /** Ventana temporal SIMULADA que cubre esta época. */
    private LocalDateTime inicioEpoca;
    private LocalDateTime finEpoca;

    /** Reloj simulado en el momento de emitir (normalmente = finEpoca). */
    private LocalDateTime relojSimulado;

    // --- Resultado de la época ---
    private int enviosDespachados;
    private int enviosPostpuestos;
    private double costoEpoca;

    /** Rutas despachadas en esta época (para dibujar en el mapa). */
    private List<RutaDTO> rutas;

    /** Ocupación de almacenes por ICAO (0-100) tras esta época. */
    private Map<String, Double> ocupacionAlmacenes;

    /**
     * C27: vuelos que operan en esta época con su carga real, incluidos los
     * que salen vacíos. Permite al mapa pintar el semáforo completo de las
     * unidades de transporte sin inventar aviones en el frontend.
     */
    private List<VueloEpocaDTO> vuelosEpoca;

    // --- Acumulado de la simulación ---
    private int totalAsignadosAcumulado;
    private double costoAcumulado;

    /** Mensaje informativo (sobre todo para INICIO/FIN/ERROR). */
    private String mensaje;

    /** Reporte final, presente en eventos de tipo COLAPSO/FIN del colapso. */
    private CollapseReportResponse reporteColapso;

    /**
     * P&R P9: instancia de vuelo cancelada ({@code plantilla@fecha}), presente en
     * los eventos de tipo CANCELACION. El mapa la usa para dejar de dibujar esa
     * salida — el avión no debe despegar — sin esperar a la siguiente época.
     */
    private String vueloCancelado;
}
