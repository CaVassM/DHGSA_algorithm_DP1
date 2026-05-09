package com.tasfb2b.dhgs.demo.algorithm;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchAdd;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearch2Opt;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchContext;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchDelete;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchRelocate;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchSwap;
import com.tasfb2b.dhgs.demo.algorithm.operators.LocalSearchSwapOut;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class LocalSearchConsistencyTest {

    @Test
    void addIncorporaElEnvioAceptadoAlGiantTour() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        Aeropuerto destino = aeropuerto("SPIM", -12.0, -77.1);
        Envio fijo = envio("E-A", origen, destino, false);
        Envio candidato = envio("E-B", origen, destino, true);

        RutaEnvio rutaFija = ruta(fijo, "V-A", 300);
        RutaEnvio rutaCandidata = ruta(candidato, "V-B", 200);

        Individuo individuo = new Individuo();
        individuo.setEnviosAsignados(new LinkedHashMap<>(Map.of(fijo, rutaFija)));
        individuo.setEnviosNoAsignados(new ArrayList<>(List.of(candidato)));
        individuo.setRepresentacionGigante(new ArrayList<>(List.of(fijo)));

        LocalSearchContext ctx = contexto(List.of(fijo, candidato), Map.of(candidato, rutaCandidata));
        Individuo resultado = new LocalSearchAdd().aplicar(individuo, ctx);

        assertTrue(resultado.getEnviosAsignados().containsKey(candidato));
        assertFalse(resultado.getEnviosNoAsignados().contains(candidato));
        assertEquals(List.of(fijo, candidato), resultado.getRepresentacionGigante());
    }

    @Test
    void deleteRemueveDelGiantTourElEnvioDescartado() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        Aeropuerto destino = aeropuerto("SCEL", -33.3, -70.7);
        Envio mustGo = envio("E-MG", origen, destino, true);
        Envio opcionalCostoso = envio("E-OP", origen, destino, false);

        RutaEnvio rutaMustGo = ruta(mustGo, "V-MG", 500);
        RutaEnvio rutaCostosa = ruta(opcionalCostoso, "V-OP", 20_000);

        Individuo individuo = new Individuo();
        individuo.setEnviosAsignados(new LinkedHashMap<>(Map.of(
                mustGo, rutaMustGo,
                opcionalCostoso, rutaCostosa)));
        individuo.setEnviosNoAsignados(new ArrayList<>());
        individuo.setRepresentacionGigante(new ArrayList<>(List.of(mustGo, opcionalCostoso)));

        LocalSearchContext ctx = contexto(List.of(mustGo, opcionalCostoso), Map.of());
        Individuo resultado = new LocalSearchDelete().aplicar(individuo, ctx);

        assertFalse(resultado.getEnviosAsignados().containsKey(opcionalCostoso));
        assertTrue(resultado.getEnviosNoAsignados().contains(opcionalCostoso));
        assertEquals(List.of(mustGo), resultado.getRepresentacionGigante());
    }

    @Test
    void swapOutReemplazaElEnvioEnElGiantTour() {
        Aeropuerto origen = aeropuerto("SEQM", -0.1, -78.3);
        Aeropuerto destino = aeropuerto("SBBR", -15.8, -47.9);
        Envio dentro = envio("E-IN", origen, destino, false);
        Envio fuera = envio("E-OUT", origen, destino, false);

        RutaEnvio rutaDentro = ruta(dentro, "V-IN", 20_000);
        RutaEnvio rutaFuera = ruta(fuera, "V-OUT", 300);

        Individuo individuo = new Individuo();
        individuo.setEnviosAsignados(new LinkedHashMap<>(Map.of(dentro, rutaDentro)));
        individuo.setEnviosNoAsignados(new ArrayList<>(List.of(fuera)));
        individuo.setRepresentacionGigante(new ArrayList<>(List.of(dentro)));

        LocalSearchContext ctx = contexto(List.of(dentro, fuera), Map.of(fuera, rutaFuera));
        Individuo resultado = new LocalSearchSwapOut().aplicar(individuo, ctx);

        assertFalse(resultado.getEnviosAsignados().containsKey(dentro));
        assertTrue(resultado.getEnviosAsignados().containsKey(fuera));
        assertTrue(resultado.getEnviosNoAsignados().contains(dentro));
        assertFalse(resultado.getEnviosNoAsignados().contains(fuera));
        assertEquals(List.of(fuera), resultado.getRepresentacionGigante());
    }

    @Test
    void validadorDetectaAsignacionesFueraDelGiantTour() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        Aeropuerto destino = aeropuerto("SPIM", -12.0, -77.1);
        Envio envio = envio("E-VAL", origen, destino, true);
        RutaEnvio ruta = ruta(envio, "V-VAL", 100);

        Individuo individuo = new Individuo();
        individuo.setEnviosAsignados(new LinkedHashMap<>(Map.of(envio, ruta)));
        individuo.setEnviosNoAsignados(new ArrayList<>());
        individuo.setRepresentacionGigante(new ArrayList<>());

        List<String> violaciones = new Validador().validarIndividuo(individuo);

        assertTrue(violaciones.stream().anyMatch(v -> v.contains("fuera del giant tour")));
    }

    @Test
    void splitActualEsInvarianteAlOrdenDelGiantTour() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        Aeropuerto destino = aeropuerto("SPIM", -12.0, -77.1);

        Vuelo vuelo = new Vuelo();
        vuelo.setId("V-DIRECTO");
        vuelo.setAeropuertoOrigen(origen);
        vuelo.setAeropuertoDestino(destino);
        vuelo.setHoraSalida(LocalTime.of(9, 0));
        vuelo.setHoraLlegada(LocalTime.of(11, 0));
        vuelo.setCapacidad(20);
        vuelo.setDistancia(1_000);
        vuelo.setDuracion(Duration.ofHours(2));

        GrafoVuelos grafo = new GrafoVuelos();
        grafo.construir(List.of(origen, destino), List.of(vuelo));
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafo);

        Envio e1 = envio("E-1", origen, destino, false);
        Envio e2 = envio("E-2", origen, destino, false);
        e2.setCantidadMaletas(2);

        Map<Envio, RutaEnvio> orden12 = split.split(List.of(e1, e2));
        Map<Envio, RutaEnvio> orden21 = split.split(List.of(e2, e1));

        assertEquals(orden12.keySet(), orden21.keySet());
        assertEquals(orden12.get(e1).getCosto(), orden21.get(e1).getCosto(), 0.001);
        assertEquals(orden12.get(e2).getCosto(), orden21.get(e2).getCosto(), 0.001);
    }

    @Test
    void almacenYMaletasSePenalizanYValidanConLosNoAsignados() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        origen.setCapacidadAlmacen(5);
        Aeropuerto destino = aeropuerto("SPIM", -12.0, -77.1);

        Envio asignado = envio("E-ASIG", origen, destino, true);
        Envio pendiente1 = envio("E-P1", origen, destino, false);
        Envio pendiente2 = envio("E-P2", origen, destino, false);
        pendiente1.setCantidadMaletas(3);
        pendiente2.setCantidadMaletas(4);

        Individuo individuo = new Individuo();
        individuo.setEnviosAsignados(new LinkedHashMap<>(Map.of(asignado, ruta(asignado, "V-ASIG", 100))));
        individuo.setEnviosNoAsignados(new ArrayList<>(List.of(pendiente1, pendiente2)));
        individuo.setRepresentacionGigante(new ArrayList<>(List.of(asignado)));

        CalculadorFitness fitness = new CalculadorFitness();
        fitness.calcularViolaciones(individuo);

        assertEquals(4.0, individuo.getViolacionesAlmacen(), 0.001,
                "El exceso de almacén debe penalizarse como (7-5)^2");

        List<String> violaciones = new Validador().validarIndividuo(individuo);
        assertTrue(violaciones.stream().anyMatch(v -> v.contains("Almacén excedido en SKBO: 7/5")));
    }

    @Test
    void operadoresDeReordenamientoNoMejoranConElSplitActual() {
        Aeropuerto origen = aeropuerto("SKBO", 4.7, -74.1);
        Aeropuerto destino = aeropuerto("SPIM", -12.0, -77.1);

        Vuelo vuelo = new Vuelo();
        vuelo.setId("V-BASE");
        vuelo.setAeropuertoOrigen(origen);
        vuelo.setAeropuertoDestino(destino);
        vuelo.setHoraSalida(LocalTime.of(9, 0));
        vuelo.setHoraLlegada(LocalTime.of(11, 0));
        vuelo.setCapacidad(30);
        vuelo.setDistancia(800);
        vuelo.setDuracion(Duration.ofHours(2));

        GrafoVuelos grafo = new GrafoVuelos();
        grafo.construir(List.of(origen, destino), List.of(vuelo));
        AlgoritmoSPLIT split = new AlgoritmoSPLIT(grafo);
        CalculadorFitness fitness = new CalculadorFitness();

        Envio e1 = envio("E-R1", origen, destino, false);
        Envio e2 = envio("E-R2", origen, destino, false);
        Envio e3 = envio("E-R3", origen, destino, false);
        e2.setCantidadMaletas(2);
        e3.setCantidadMaletas(3);

        Individuo base = new Individuo();
        base.setRepresentacionGigante(new ArrayList<>(List.of(e1, e2, e3)));
        base.setEnviosAsignados(split.split(base.getRepresentacionGigante()));
        base.setEnviosNoAsignados(new ArrayList<>());
        fitness.calcularViolaciones(base);
        fitness.calcular(base, 1, 1);

        LocalSearchContext ctx = new LocalSearchContext(split, fitness, 1, 1, List.of(e1, e2, e3));

        assertMismaSolucion(base, new LocalSearchRelocate().aplicar(base, ctx));
        assertMismaSolucion(base, new LocalSearchSwap().aplicar(base, ctx));
        assertMismaSolucion(base, new LocalSearch2Opt().aplicar(base, ctx));
    }

    private void assertMismaSolucion(Individuo esperado, Individuo actual) {
        assertEquals(esperado.getRepresentacionGigante(), actual.getRepresentacionGigante());
        assertEquals(esperado.getEnviosAsignados().keySet(), actual.getEnviosAsignados().keySet());
        assertEquals(esperado.getEnviosNoAsignados(), actual.getEnviosNoAsignados());
        assertEquals(esperado.getFitness(), actual.getFitness(), 0.001);
        assertEquals(esperado.getCostoDistanciaTotal(), actual.getCostoDistanciaTotal(), 0.001);
    }

    private LocalSearchContext contexto(List<Envio> universo, Map<Envio, RutaEnvio> rutasDisponibles) {
        return new LocalSearchContext(new SplitStub(rutasDisponibles), new CalculadorFitness(), 1, 1, universo);
    }

    private Envio envio(String id, Aeropuerto origen, Aeropuerto destino, boolean mustGo) {
        Envio envio = new Envio();
        envio.setId(id);
        envio.setAeropuertoOrigen(origen);
        envio.setAeropuertoDestino(destino);
        envio.setFechaHoraCreacion(LocalDateTime.of(2026, 1, 1, 8, 0));
        envio.setDeadline(LocalDateTime.of(2026, 1, 2, 8, 0));
        envio.setCantidadMaletas(1);
        envio.setEsMustGo(mustGo);
        return envio;
    }

    private Aeropuerto aeropuerto(String codigo, double lat, double lon) {
        Aeropuerto aeropuerto = new Aeropuerto();
        aeropuerto.setCodigoICAO(codigo);
        aeropuerto.setCapacidadAlmacen(1_000);
        aeropuerto.setContinente("America");
        aeropuerto.setCiudad(codigo);
        aeropuerto.setPais("NA");
        aeropuerto.setLatitud(lat);
        aeropuerto.setLongitud(lon);
        return aeropuerto;
    }

    private RutaEnvio ruta(Envio envio, String vueloId, double distancia) {
        Vuelo vuelo = new Vuelo();
        vuelo.setId(vueloId);
        vuelo.setAeropuertoOrigen(envio.getAeropuertoOrigen());
        vuelo.setAeropuertoDestino(envio.getAeropuertoDestino());
        vuelo.setHoraSalida(LocalTime.of(9, 0));
        vuelo.setHoraLlegada(LocalTime.of(11, 0));
        vuelo.setCapacidad(50);
        vuelo.setDistancia(distancia);
        vuelo.setDuracion(Duration.ofHours(2));

        RutaEnvio ruta = new RutaEnvio();
        ruta.setEnvio(envio);
        ruta.setSecuenciaVuelos(new ArrayList<>(List.of(vuelo)));
        ruta.calcularTiempos();
        return ruta;
    }

    private static class SplitStub extends AlgoritmoSPLIT {
        private final Map<Envio, RutaEnvio> rutasPorEnvio;

        private SplitStub(Map<Envio, RutaEnvio> rutasPorEnvio) {
            super(new GrafoVuelos());
            this.rutasPorEnvio = new HashMap<>(rutasPorEnvio);
        }

        @Override
        public RutaEnvio asignarMejorRuta(Envio envio) {
            RutaEnvio ruta = rutasPorEnvio.get(envio);
            return ruta != null ? ruta.clonar() : null;
        }

        @Override
        public Map<Envio, RutaEnvio> split(List<Envio> giantTour) {
            Map<Envio, RutaEnvio> asignaciones = new LinkedHashMap<>();
            for (Envio envio : giantTour) {
                RutaEnvio ruta = asignarMejorRuta(envio);
                if (ruta != null) {
                    asignaciones.put(envio, ruta);
                }
            }
            return asignaciones;
        }
    }
}

