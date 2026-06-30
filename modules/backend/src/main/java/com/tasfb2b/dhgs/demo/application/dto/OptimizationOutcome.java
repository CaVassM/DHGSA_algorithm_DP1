package com.tasfb2b.dhgs.demo.application.dto;

import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.Map;

/**
 * Resultado completo de una corrida de optimización. Incluye el DTO público y
 * las estructuras de dominio necesarias para persistir las rutas (referencias
 * a Envio y a la secuencia de Vuelo dentro de cada RutaEnvio).
 */
public record OptimizationOutcome(
        OptimizationResponse response,
        Map<Long, RutaEnvio> rutasPorShipmentId,
        Map<Long, Envio> enviosPorShipmentId
) {}