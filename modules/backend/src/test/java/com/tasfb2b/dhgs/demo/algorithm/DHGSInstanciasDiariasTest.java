package com.tasfb2b.dhgs.demo.algorithm;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.DHGSAlgorithm;
import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DHGSInstanciasDiariasTest {

    @Test
    void usaInstanciasDiariasDelSiguienteDiaCuandoElEnvioLlegaDespuesDelHorarioBase() {
        Aeropuerto a = aeropuerto("SKBO", 500, 4.7, -74.1);
        Aeropuerto b = aeropuerto("SPIM", 500, -12.0, -77.1);
        Aeropuerto c = aeropuerto("SCEL", 500, -33.3, -70.7);

        Vuelo corto1 = vuelo("F1", a, b, LocalTime.of(3, 0), LocalTime.of(4, 0), 20);
        Vuelo corto2 = vuelo("F2", b, c, LocalTime.of(4, 30), LocalTime.of(5, 30), 20);
        Vuelo alternativo = vuelo("F3", a, c, LocalTime.of(6, 0), LocalTime.of(9, 0), 20);

        GrafoVuelos grafo = new GrafoVuelos();
        grafo.construir(List.of(a, b, c), List.of(corto1, corto2, alternativo), LocalDate.of(2026, 1, 1), 5);

        Envio envio = new Envio();
        envio.setId("E1");
        envio.setAeropuertoOrigen(a);
        envio.setAeropuertoDestino(c);
        envio.setCantidadMaletas(5);
        envio.setFechaHoraCreacion(LocalDateTime.of(2026, 1, 2, 23, 30));
        envio.setDeadline(LocalDateTime.of(2026, 1, 3, 12, 0));
        envio.setEsMustGo(true);

        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafo);
        CalculadorFitness fitness = new CalculadorFitness();
        Validador validador = new Validador();
        ConstructorSolucionesIniciales constructor = new ConstructorSolucionesIniciales(grafo, split, fitness);
        DHGSAlgorithm dhgs = new DHGSAlgorithm(constructor, split, fitness, validador);

        Individuo resultado = dhgs.ejecutar(List.of(envio), 1, 30, 6, Duration.ofSeconds(1));

        assertNotNull(resultado);
        RutaEnvio ruta = resultado.getEnviosAsignados().get(envio);
        assertNotNull(ruta);
        assertEquals(2, ruta.getSecuenciaVuelos().size(), "Debe usar la conexión más temprana del día siguiente");
        assertTrue(ruta.getSecuenciaVuelos().stream().allMatch(v -> v instanceof InstanciaVuelo));
        assertEquals("F1@2026-01-03", ruta.getSecuenciaVuelos().get(0).getId());
        assertEquals("F2@2026-01-03", ruta.getSecuenciaVuelos().get(1).getId());
        assertEquals(LocalDateTime.of(2026, 1, 3, 3, 0), ruta.getTiempoInicio());
        assertEquals(LocalDateTime.of(2026, 1, 3, 5, 30), ruta.getTiempoLlegadaEstimado());
        assertTrue(resultado.isEsFactible());
        assertTrue(validador.validarIndividuo(resultado).isEmpty());
    }

    private Aeropuerto aeropuerto(String codigo, int capacidad, double lat, double lon) {
        Aeropuerto aeropuerto = new Aeropuerto();
        aeropuerto.setCodigoICAO(codigo);
        aeropuerto.setCapacidadAlmacen(capacidad);
        aeropuerto.setContinente("America");
        aeropuerto.setCiudad(codigo);
        aeropuerto.setPais("NA");
        aeropuerto.setLatitud(lat);
        aeropuerto.setLongitud(lon);
        return aeropuerto;
    }

    private Vuelo vuelo(String id, Aeropuerto origen, Aeropuerto destino,
                        LocalTime salida, LocalTime llegada, int capacidad) {
        Vuelo vuelo = new Vuelo();
        vuelo.setId(id);
        vuelo.setAeropuertoOrigen(origen);
        vuelo.setAeropuertoDestino(destino);
        vuelo.setHoraSalida(salida);
        vuelo.setHoraLlegada(llegada);
        vuelo.setCapacidad(capacidad);
        vuelo.setDistancia(origen.getDistanciaA(destino));
        vuelo.setDuracion(Duration.between(salida, llegada).isNegative()
                ? Duration.between(salida, llegada).plusHours(24)
                : Duration.between(salida, llegada));
        return vuelo;
    }
}

