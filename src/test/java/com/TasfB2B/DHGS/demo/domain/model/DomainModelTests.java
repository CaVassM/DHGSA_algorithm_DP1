package com.TasfB2B.DHGS.demo.domain.model;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DomainModelTests {

    @Test
    void vueloCruzandoMedianocheCalculaDuracionPositiva() {
        Vuelo vuelo = new Vuelo();
        vuelo.setHoraSalida(LocalTime.of(23, 30));
        vuelo.setHoraLlegada(LocalTime.of(1, 15));

        assertEquals(105, vuelo.getTiempoVuelo());
        assertEquals(Duration.ofMinutes(105), vuelo.getDuracion());
    }

    @Test
    void envioCalculaDeadlineYMustGo() {
        Aeropuerto bogota = aeropuerto("SKBO", "America", 4.7014, -74.1469, 500);
        Aeropuerto lima = aeropuerto("SPIM", "America", -12.0219, -77.1143, 400);

        Envio envio = new Envio();
        envio.setAeropuertoOrigen(bogota);
        envio.setAeropuertoDestino(lima);
        envio.setFechaHoraCreacion(LocalDateTime.of(2026, 1, 2, 0, 47));

        assertEquals(LocalDateTime.of(2026, 1, 3, 0, 47), envio.calcularDeadline());

        envio.actualizarMustGo(LocalDateTime.of(2026, 1, 2, 20, 0), 8);
        assertTrue(envio.isEsMustGo());

        envio.actualizarMustGo(LocalDateTime.of(2026, 1, 2, 10, 0), 8);
        assertFalse(envio.isEsMustGo());
    }

    @Test
    void rutaFactibleCostoYRetraso() {
        Aeropuerto bogota = aeropuerto("SKBO", "America", 4.7014, -74.1469, 500);
        Aeropuerto lima = aeropuerto("SPIM", "America", -12.0219, -77.1143, 400);
        Aeropuerto santiago = aeropuerto("SCEL", "America", -33.3930, -70.7858, 600);

        Envio envio = new Envio();
        envio.setAeropuertoOrigen(bogota);
        envio.setAeropuertoDestino(santiago);
        envio.setFechaHoraCreacion(LocalDateTime.of(2026, 1, 2, 0, 47));
        envio.setCantidadMaletas(5);
        envio.calcularDeadline();

        Vuelo v1 = new Vuelo();
        v1.setAeropuertoOrigen(bogota);
        v1.setAeropuertoDestino(lima);
        v1.setHoraSalida(LocalTime.of(3, 0));
        v1.setHoraLlegada(LocalTime.of(5, 0));
        v1.setDistancia(1880);

        Vuelo v2 = new Vuelo();
        v2.setAeropuertoOrigen(lima);
        v2.setAeropuertoDestino(santiago);
        v2.setHoraSalida(LocalTime.of(6, 0));
        v2.setHoraLlegada(LocalTime.of(10, 0));
        v2.setDistancia(2450);

        RutaEnvio ruta = new RutaEnvio();
        ruta.setEnvio(envio);
        ruta.setSecuenciaVuelos(List.of(v1, v2));

        assertTrue(ruta.esFactible());
        assertEquals(4330.0, ruta.getDistanciaTotal(), 0.001);
        assertEquals(21650.0, ruta.getCosto(), 0.001);

        envio.setDeadline(LocalDateTime.of(2026, 1, 2, 9, 0));
        assertEquals(60, ruta.getRetraso());
    }

    @Test
    void almacenActualizaMaletasYOcupacion() {
        Aeropuerto bogota = aeropuerto("SKBO", "America", 4.7014, -74.1469, 100);

        Envio envio = new Envio();
        envio.setId("E1");
        envio.setCantidadMaletas(25);

        AlmacenEstado almacen = new AlmacenEstado();
        almacen.setAeropuerto(bogota);

        almacen.agregarEnvio(envio);
        assertEquals(25, almacen.getMaletasActuales());
        assertEquals(0.25, almacen.getNivelOcupacion(), 0.0001);

        almacen.removerEnvio(envio);
        assertEquals(0, almacen.getMaletasActuales());
    }

    private Aeropuerto aeropuerto(String codigo, String continente, double lat, double lon, int capacidad) {
        Aeropuerto aeropuerto = new Aeropuerto();
        aeropuerto.setCodigoICAO(codigo);
        aeropuerto.setContinente(continente);
        aeropuerto.setLatitud(lat);
        aeropuerto.setLongitud(lon);
        aeropuerto.setCapacidadAlmacen(capacidad);
        aeropuerto.setCiudad(codigo);
        aeropuerto.setPais("NA");
        return aeropuerto;
    }
}

