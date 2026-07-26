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

    /**
     * Aeropuerto donde está instalada la terminal que registra.
     *
     * <p>No lo teclea el operador: lo fija la estación de trabajo al abrir la
     * pantalla. El enunciado lo pide así — "resulta redundante/innecesario y
     * hasta riesgoso que el personal de registro de maletas registre la ciudad
     * de origen, pues se trata de una computadora que está todo el tiempo en
     * dicho aeropuerto". Sigue viajando en la petición porque el servidor no
     * tiene otra forma de saber desde dónde se registra.
     */
    @NotBlank(message = "La terminal no tiene un aeropuerto asignado.")
    private String origenIcao;

    @NotBlank(message = "El aeropuerto de destino (código ICAO) es obligatorio.")
    private String destinoIcao;

    @Positive(message = "La cantidad de maletas debe ser mayor que cero.")
    private int cantidadMaletas;

    /** Aerolínea que solicita el envío (opcional). */
    private String idCliente;

    /**
     * Fecha y hora locales del aeropuerto de origen en que se recibe la maleta.
     *
     * <p>Opcional: si no llega, el servidor la deduce de su propio reloj
     * convirtiéndolo al huso del aeropuerto. Se acepta para la carga de archivos,
     * donde cada registro trae su hora, y porque durante la prueba cada estudiante
     * tiene su equipo puesto en el huso de la ciudad que le toca — es esa hora, la
     * de la terminal, la que debe quedar registrada, no la del servidor.
     */
    private String fechaHoraLocal;
}
