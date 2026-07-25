package com.tasfb2b.backend.dto.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Vuelo que opera durante una época, con la carga que realmente transporta.
 *
 * <p>C27: el mapa necesita pintar el semáforo de cada unidad de transporte
 * <b>incluido el estado "vacío"</b>. Un vuelo vacío es el que la simulación
 * despachó sin ningún envío asignado; no puede deducirse en el frontend a
 * partir del catálogo de plantillas, porque eso inventaría aviones que la
 * planificación nunca despachó. Por eso el backend informa aquí todas las
 * instancias de vuelo de la época con sus maletas a bordo (0 si va vacío).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class VueloEpocaDTO {

    /** Identificador de negocio de la plantilla de vuelo. */
    private String businessId;

    private String origenIcao;
    private String destinoIcao;

    /** Momento exacto de salida/llegada de esta ocurrencia del vuelo. */
    private LocalDateTime salida;
    private LocalDateTime llegada;

    /** Capacidad del avión y maletas efectivamente asignadas (0 => vacío). */
    private int capacidad;
    private int maletas;

    /** Cantidad de envíos distintos que viajan en el vuelo. */
    private int envios;
}
