package com.TasfB2B.DHGS.demo.infraestructure.util;

import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Algoritmo SPLIT adaptado para DHGS / Tasf.B2B.
 *
 * En el HGS clásico, SPLIT divide un "giant tour" en rutas de vehículos.
 * En Tasf.B2B, SPLIT asigna cada envío del giant tour a una secuencia de vuelos existentes.
 *
 * Proceso:
 * 1. Recibir un giant tour (lista ordenada de envíos)
 * 2. Para cada envío, buscar la mejor ruta de vuelos (Dijkstra en el grafo)
 * 3. Asignar el envío a esa ruta
 * 4. Retornar el mapa de asignaciones
 *
 * TODO: La implementación O(n) del paper Vidal requiere refinamiento.
 */
@Component
public class AlgoritmoSPLIT {

    private final GrafoVuelos grafoVuelos;

    public AlgoritmoSPLIT(GrafoVuelos grafoVuelos) {
        this.grafoVuelos = grafoVuelos;
    }

    /**
     * Aplica SPLIT al giant tour: para cada envío encuentra la mejor ruta de vuelos.
     *
     * @param giantTour lista ordenada de envíos a asignar
     * @return mapa de envío → ruta asignada (vacío si no hay rutas posibles)
     */
    public Map<Envio, RutaEnvio> split(List<Envio> giantTour) {
        Map<Envio, RutaEnvio> asignaciones = new LinkedHashMap<>();

        if (giantTour == null || giantTour.isEmpty()) {
            return asignaciones;
        }

        for (Envio envio : giantTour) {
            RutaEnvio ruta = asignarMejorRuta(envio);
            if (ruta != null) {
                asignaciones.put(envio, ruta);
            }
        }

        return asignaciones;
    }

    /**
     * Encuentra la mejor ruta de vuelos para un envío individual.
     * Usa Dijkstra del grafo de vuelos para encontrar el camino más rápido.
     *
     * @param envio envío a asignar
     * @return mejor ruta encontrada, o null si no hay conexión
     */
    public RutaEnvio asignarMejorRuta(Envio envio) {
        if (envio == null || envio.getAeropuertoOrigen() == null ||
            envio.getAeropuertoDestino() == null) {
            return null;
        }

        List<Vuelo> vuelosMejorRuta = grafoVuelos.dijkstraMenorTiempo(
                envio.getAeropuertoOrigen(),
                envio.getAeropuertoDestino()
        );

        if (vuelosMejorRuta.isEmpty()) {
            return null;
        }

        // Construir RutaEnvio
        RutaEnvio ruta = new RutaEnvio();
        ruta.setEnvio(envio);
        ruta.setSecuenciaVuelos(new ArrayList<>(vuelosMejorRuta));
        ruta.calcularTiempos();

        return ruta;
    }

    /**
     * Versión de SPLIT que también genera rutas alternativas (para diversidad).
     *
     * @param giantTour lista de envíos
     * @param kAlternativas número de rutas alternativas a considerar por envío
     * @return mapa de asignaciones
     */
    public Map<Envio, RutaEnvio> splitConAlternativas(List<Envio> giantTour, int kAlternativas) {
        Map<Envio, RutaEnvio> asignaciones = new LinkedHashMap<>();

        if (giantTour == null || giantTour.isEmpty()) {
            return asignaciones;
        }

        Random random = new Random();

        for (Envio envio : giantTour) {
            List<List<Vuelo>> alternativas = grafoVuelos.encontrarKRutas(
                    envio.getAeropuertoOrigen(),
                    envio.getAeropuertoDestino(),
                    kAlternativas
            );

            if (alternativas.isEmpty()) continue;

            // Elegir una ruta aleatoriamente entre las K mejores (diversidad)
            List<Vuelo> vuelosElegidos = alternativas.get(random.nextInt(alternativas.size()));

            RutaEnvio ruta = new RutaEnvio();
            ruta.setEnvio(envio);
            ruta.setSecuenciaVuelos(new ArrayList<>(vuelosElegidos));
            ruta.calcularTiempos();

            asignaciones.put(envio, ruta);
        }

        return asignaciones;
    }
}

