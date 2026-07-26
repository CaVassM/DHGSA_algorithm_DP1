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

    /** Deadline calculado según mismo/distinto continente (1 o 2 días), en UTC. */
    private LocalDateTime deadline;

    /**
     * Momento de la recepción en la hora de pared del aeropuerto de origen: la
     * que marcaba el reloj del mostrador que registró la maleta.
     */
    private LocalDateTime registradoLocal;

    /**
     * Plazo de entrega en la hora de pared del aeropuerto de DESTINO — donde hay
     * que entregar la maleta y donde alguien la espera. Mostrarlo en la hora del
     * origen (o del servidor) obligaría al operador a hacer la conversión de
     * cabeza para saber si el plazo es holgado o ajustado.
     */
    private LocalDateTime deadlineLocalDestino;

    /** Husos de origen y destino ("GMT-5"), para acompañar a las horas. */
    private String gmtOrigen;
    private String gmtDestino;

    /** Secuencia de vuelos (flightBusinessId) que componen la ruta, en orden. */
    private List<String> rutaVuelos;

    /** true si la ruta es directa (un solo vuelo). */
    private boolean directa;

    /** Número de escalas (vuelos - 1). */
    private int escalas;
}
