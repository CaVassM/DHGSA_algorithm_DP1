package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

/**
 * Resultado de cancelar un vuelo en la operación día a día (P&R P9).
 *
 * <p>La operación es continua: no hay una siguiente ronda de planificación donde
 * recolocar la carga, así que la reasignación ocurre en el acto y este es su
 * parte. Distingue los envíos que encontraron otro vuelo de los que no, porque
 * son los segundos los que exigen una decisión del operador.
 */
@Data
@Builder
public class DailyCancelResponse {

    /** false si no se pudo cancelar (jornada cerrada, vuelo inexistente, sin margen). */
    private boolean aplicada;

    /** Resumen legible de lo ocurrido. */
    private String mensaje;

    // --- Salida cancelada ---

    /** Vuelo recurrente al que pertenece la salida. */
    private String idVuelo;

    /** Salida concreta cancelada ({@code vuelo@fecha}). */
    private String idInstancia;

    private LocalDate fechaOperacion;
    private LocalTime horaSalida;
    private String origenIcao;
    private String destinoIcao;

    // --- Efecto sobre la carga ---

    private int enviosAfectados;
    private int maletasAfectadas;

    /** Envíos que encontraron otro vuelo, con su ruta anterior y la nueva. */
    private List<EnvioReasignado> enviosReasignados;

    /**
     * Envíos que NO pudieron recolocarse. Quedan sin ruta y a la vista: no se
     * descartan en silencio, porque es la información que el operador necesita
     * para decidir qué hacer con esas maletas.
     */
    private List<EnvioReasignado> enviosSinRuta;

    @Data
    @Builder
    public static class EnvioReasignado {
        private String envioId;
        private String origenIcao;
        private String destinoIcao;
        private int cantidadMaletas;

        /** Ruta que llevaba antes de la cancelación. */
        private List<String> rutaAnterior;

        /** Ruta asignada tras la cancelación; vacía si no se encontró ninguna. */
        private List<String> rutaNueva;
    }
}
