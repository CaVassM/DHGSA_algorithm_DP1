package com.tasfb2b.backend.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import lombok.Data;

/**
 * Petición de registro manual de un envío en la operación día a día.
 *
 * A diferencia de la simulación de periodo, aquí los envíos llegan uno a uno
 * (registro manual del operador). No se corre el optimizador: solo se valida
 * que exista una ruta de vuelos con capacidad y se descuenta esa capacidad
 * en vivo. Ver {@code OperationalScenario.REAL_TIME}.
 */
@Data
public class DailyRegisterRequest {

    @NotBlank(message = "El aeropuerto de origen (código ICAO) es obligatorio.")
    private String origenIcao;

    @NotBlank(message = "El aeropuerto de destino (código ICAO) es obligatorio.")
    private String destinoIcao;

    @Positive(message = "La cantidad de maletas debe ser mayor que cero.")
    private int cantidadMaletas;

    /** Aerolínea que solicita el envío (opcional). */
    private String idCliente;
}
