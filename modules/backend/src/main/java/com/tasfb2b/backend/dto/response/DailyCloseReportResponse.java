package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * G09: reporte de la última planificación estable al CERRAR las operaciones
 * día a día (escenario REAL_TIME).
 *
 * <p>Hasta ahora el día a día solo exponía su estado vivo ({@link DailyStateResponse}),
 * que cambia con cada registro y se perdía al reiniciar. Este reporte congela
 * la foto final de la jornada: qué se aceptó, qué se rechazó y por qué, cómo
 * quedaron las capacidades y si se llegó al colapso. Una vez cerrado, el
 * contenido es inmutable — se puede volver a consultar y a imprimir.
 *
 * <p>Es el equivalente, para la operación en tiempo real, de lo que
 * {@code ReportePeriodo} es para la simulación de periodo y
 * {@link CollapseReportResponse} para la de colapso.
 */
@Data
@Builder
public class DailyCloseReportResponse {

    /** Momento en que se cerró la jornada. */
    private LocalDateTime fechaCierre;

    /** Momento del primer registro de la jornada (null si no hubo ninguno). */
    private LocalDateTime inicioOperacion;

    // --- Totales de la jornada ---

    private int totalRegistrados;
    private int totalAceptados;
    private int totalRechazados;
    private int totalMaletasDespachadas;

    /**
     * Porcentaje de envíos atendidos sobre los registrados (0-100). Es el
     * indicador de cumplimiento de la jornada; el frontend le aplica el
     * semáforo verde/ámbar/rojo.
     */
    private double porcentajeAtencion;

    // --- Estado de la flota al cierre ---

    /** Ocupación global de la flota al momento del cierre (0-100). */
    private double ocupacionFlotaPorcentaje;

    /** true si al cerrar ningún vuelo admitía más carga. */
    private boolean colapsoTotal;

    private int vuelosOperados;
    private int vuelosSaturados;

    /** Resumen legible del desenlace de la jornada. */
    private String motivo;

    // --- Detalle ---

    /** Envíos aceptados, en orden de registro. */
    private List<EnvioCerrado> enviosAtendidos;

    /** Envíos rechazados con el motivo, en orden de registro. */
    private List<EnvioRechazado> enviosRechazados;

    /** Vuelos más cargados al cierre (para ver dónde se concentró la presión). */
    private List<DailyStateResponse.FlightLoad> vuelosMasCargados;

    @Data
    @Builder
    public static class EnvioCerrado {
        private String envioId;
        private String origenIcao;
        private String destinoIcao;
        private int cantidadMaletas;
        private String idCliente;
        private LocalDateTime registradoEn;
        private LocalDateTime deadline;
        private List<String> rutaVuelos;
        private boolean directa;
        private int escalas;
    }

    @Data
    @Builder
    public static class EnvioRechazado {
        private String origenIcao;
        private String destinoIcao;
        private int cantidadMaletas;
        private LocalDateTime registradoEn;
        private String motivo;
    }
}
