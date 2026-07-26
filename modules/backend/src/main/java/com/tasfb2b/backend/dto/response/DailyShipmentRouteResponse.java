package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Envío registrado en la operación día a día con la ruta que sigue.
 *
 * <p>Es lo que el mapa necesita para dibujar "todas las rutas del envío de
 * manera gráfica": los tramos en orden, cada uno con su aeropuerto de salida y
 * llegada y las horas correspondientes.
 *
 * <p>Las horas viajan en dos versiones a propósito. En UTC para poder ordenar y
 * animar (los tramos de una ruta cruzan husos, y comparar horas de pared daría
 * un orden falso), y en hora local de cada aeropuerto para mostrarlas: un tramo
 * que sale de Lima y llega a Madrid se lee en la hora de Lima al despegar y en
 * la de Madrid al aterrizar, que es como lo ve la operación.
 */
@Data
@Builder
public class DailyShipmentRouteResponse {

    private String envioId;
    private String origenIcao;
    private String destinoIcao;
    private int cantidadMaletas;
    private String idCliente;

    /** Recepción, en hora local del aeropuerto de origen. */
    private LocalDateTime registradoLocal;

    /** Entrega prevista al cliente, en hora local del destino (P&R P16). */
    private LocalDateTime entregaLocalDestino;

    /** Plazo máximo, en hora local del destino. */
    private LocalDateTime deadlineLocalDestino;

    private String gmtOrigen;
    private String gmtDestino;

    /** true si la ruta es un solo vuelo. */
    private boolean directa;

    /** Número de escalas (tramos - 1). */
    private int escalas;

    /** Tramos en orden de vuelo. */
    private List<Tramo> tramos;

    @Data
    @Builder
    public static class Tramo {
        /** Identificador de la salida concreta ({@code vuelo@fecha}). */
        private String vueloId;

        private String origenIcao;
        private String destinoIcao;

        /** Salida y llegada en UTC: sirven para ordenar y animar. */
        private LocalDateTime salidaUtc;
        private LocalDateTime llegadaUtc;

        /** Las mismas, en la hora de pared de cada aeropuerto. */
        private LocalDateTime salidaLocal;
        private LocalDateTime llegadaLocal;

        private String gmtOrigen;
        private String gmtDestino;

        /**
         * Capacidad total del vuelo FÍSICO (no de este envío). El mapa la usa
         * para calcular el % de ocupación y colorear el avión igual que en el
         * mapa en vivo de la simulación (semáforo por ocupación).
         */
        private int capacidad;

        /**
         * Minutos que la maleta espera en este aeropuerto antes de despegar. 0 en
         * el primer tramo: la maleta ya estaba en el almacén cuando se registró.
         */
        private long esperaMinutos;

        /** true si esta salida fue cancelada. */
        private boolean cancelado;
    }
}