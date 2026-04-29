package com.TasfB2B.DHGS.demo.domain.service;

import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimuladorEpocasTest {

    @Test
    void organizaEpocasDesdeElDiaAnteriorAlPrimerEnvioCuandoNoSeEspecificaInicio() {
        SimuladorEpocas simulador = new SimuladorEpocas();
        Aeropuerto skbo = aeropuerto("SKBO", 400);
        Aeropuerto spim = aeropuerto("SPIM", 400);
        Envio envio = envio("E1", skbo, spim, LocalDateTime.of(2026, 1, 2, 0, 47), 3);

        List<EpocaData> historial = simulador.organizarEnEpocas(
                List.of(envio), List.of(skbo, spim), null, 4);

        assertFalse(historial.isEmpty());
        assertEquals(30, historial.size(), "Con 5 días y épocas de 4h deben generarse 30 épocas");
        assertEquals(LocalDateTime.of(2026, 1, 1, 0, 0), historial.get(0).getInicio());
        assertEquals(LocalDateTime.of(2026, 1, 1, 4, 0), historial.get(0).getFin());

        EpocaData epocaConEnvio = historial.stream()
                .filter(e -> !e.getEnviosNuevos().isEmpty())
                .findFirst()
                .orElseThrow();

        assertEquals(LocalDateTime.of(2026, 1, 2, 0, 0), epocaConEnvio.getInicio());
        assertEquals(1, epocaConEnvio.getEnviosNuevos().size());
    }

    @Test
    void respetaFechaInicioExplicitaYElCalendarioCruzaDeDiaCada24Horas() {
        SimuladorEpocas simulador = new SimuladorEpocas();
        Aeropuerto skbo = aeropuerto("SKBO", 400);
        Aeropuerto spim = aeropuerto("SPIM", 400);
        Envio envio = envio("E1", skbo, spim, LocalDateTime.of(2026, 1, 2, 0, 47), 3);

        List<EpocaData> historial = simulador.organizarEnEpocas(
                List.of(envio), List.of(skbo, spim), LocalDateTime.of(2026, 1, 1, 0, 0), 4);

        assertEquals(30, historial.size(), "La simulación debe cubrir exactamente 5 días");
        assertEquals(LocalDateTime.of(2026, 1, 1, 20, 0), historial.get(5).getInicio());
        assertEquals(LocalDateTime.of(2026, 1, 2, 0, 0), historial.get(5).getFin());
        assertEquals(LocalDateTime.of(2026, 1, 2, 0, 0), historial.get(6).getInicio());
        assertEquals(LocalDateTime.of(2026, 1, 2, 4, 0), historial.get(6).getFin());
        assertEquals(LocalDateTime.of(2026, 1, 6, 0, 0), historial.get(29).getFin());
    }

    private Envio envio(String id, Aeropuerto origen, Aeropuerto destino,
                        LocalDateTime fechaHora, int maletas) {
        Envio envio = new Envio();
        envio.setId(id);
        envio.setAeropuertoOrigen(origen);
        envio.setAeropuertoDestino(destino);
        envio.setFechaHoraCreacion(fechaHora);
        envio.setCantidadMaletas(maletas);
        envio.calcularDeadline();
        return envio;
    }

    private Aeropuerto aeropuerto(String icao, int capacidad) {
        Aeropuerto aeropuerto = new Aeropuerto();
        aeropuerto.setCodigoICAO(icao);
        aeropuerto.setCiudad(icao);
        aeropuerto.setPais("NA");
        aeropuerto.setContinente("America");
        aeropuerto.setCapacidadAlmacen(capacidad);
        aeropuerto.setLatitud(0.0);
        aeropuerto.setLongitud(0.0);
        return aeropuerto;
    }
}
