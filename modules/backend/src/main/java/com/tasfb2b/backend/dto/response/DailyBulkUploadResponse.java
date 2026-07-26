package com.tasfb2b.backend.dto.response;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * Resultado de subir un archivo de envíos en la operación día a día.
 *
 * <p>Cada línea del archivo se registra por el mismo camino que un envío tecleado
 * a mano, así que puede aceptarse o rechazarse por los mismos motivos (sin ruta,
 * capacidad saturada). El detalle viaja en {@code registros} para que la pantalla
 * muestre línea a línea qué pasó, igual que con los registros manuales.
 */
@Data
@Builder
public class DailyBulkUploadResponse {

    /** Aeropuerto de la terminal que subió el archivo. */
    private String origenIcao;

    /** Líneas que se pudieron leer e intentar registrar. */
    private int lineasProcesadas;

    private int aceptados;
    private int rechazados;

    /**
     * Líneas que no se pudieron interpretar (formato inválido), con el número de
     * línea. Se informan aparte de los rechazos: un rechazo es una decisión de la
     * operación, un error de formato es un problema del archivo.
     */
    private List<String> errores;

    /** Resultado de cada línea registrada, en orden. */
    private List<DailyRegisterResponse> registros;
}
