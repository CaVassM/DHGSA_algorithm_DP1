package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Resultado de un registro manual en la operación día a día.
 *
 * Si {@code aceptado} es true, el envío encontró ruta con capacidad y esta
 * ya fue descontada en vivo. Si es false, no se pudo asignar (no hay vuelo
 * para la ruta o la capacidad está saturada → indicio de colapso): el motivo
 * se explica en {@code mensaje}.
 */
@Data
@Builder
public class DailyRegisterResponse {

    private boolean aceptado;
    private String mensaje;

    /** Id de negocio asignado al envío registrado (solo si fue aceptado). */
    private String envioId;

    private String origenIcao;
    private String destinoIcao;
    private int cantidadMaletas;

    /** Deadline calculado según mismo/distinto continente (1 o 2 días). */
    private LocalDateTime deadline;

    /** Secuencia de vuelos (flightBusinessId) que componen la ruta, en orden. */
    private List<String> rutaVuelos;

    /** true si la ruta es directa (un solo vuelo). */
    private boolean directa;

    /** Número de escalas (vuelos - 1). */
    private int escalas;
}
