package com.TasfB2B.DHGS.demo.infraestructure.util;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Validador de restricciones para soluciones del algoritmo DHGS.
 * Verifica capacidades de vuelos, almacenes, deadlines y conectividad.
 */
@Component
public class Validador {

    /**
     * Valida si un vuelo no excede su capacidad con las maletas asignadas.
     *
     * @param vuelo vuelo a validar
     * @param maletasAsignadas cantidad total de maletas asignadas a este vuelo
     * @return true si no excede capacidad
     */
    public boolean validarCapacidadVuelo(Vuelo vuelo, int maletasAsignadas) {
        if (vuelo == null) return false;
        return maletasAsignadas <= vuelo.getCapacidadDisponible();
    }

    /**
     * Valida que la ruta cumple con el deadline del envío.
     */
    public boolean validarDeadline(RutaEnvio ruta) {
        if (ruta == null || ruta.getEnvio() == null) return false;
        return ruta.esFactible();
    }

    /**
     * Valida la conectividad de una ruta (que los vuelos sean consecutivos geográficamente).
     */
    public boolean validarConexiones(RutaEnvio ruta) {
        if (ruta == null || ruta.getSecuenciaVuelos() == null) return false;

        List<Vuelo> vuelos = ruta.getSecuenciaVuelos();
        for (int i = 0; i < vuelos.size() - 1; i++) {
            String destinoActual = vuelos.get(i).getAeropuertoDestino().getCodigoICAO();
            String origenSiguiente = vuelos.get(i + 1).getAeropuertoOrigen().getCodigoICAO();
            if (!destinoActual.equals(origenSiguiente)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Valida un individuo completo y retorna lista de violaciones encontradas.
     *
     * @return lista de mensajes de violación (vacía si es completamente válido)
     */
    public List<String> validarIndividuo(Individuo individuo) {
        List<String> violaciones = new ArrayList<>();

        if (individuo == null) {
            violaciones.add("Individuo es null");
            return violaciones;
        }

        Map<Envio, RutaEnvio> asignados = individuo.getEnviosAsignados();
        if (asignados == null || asignados.isEmpty()) {
            violaciones.add("No hay envíos asignados");
            return violaciones;
        }

        // 1. Verificar must-go no asignados
        if (individuo.getEnviosNoAsignados() != null) {
            for (Envio e : individuo.getEnviosNoAsignados()) {
                if (e.isEsMustGo()) {
                    violaciones.add(String.format("Must-go no asignado: envío %s → %s",
                            e.getId(), e.getAeropuertoDestino().getCodigoICAO()));
                }
                if (asignados.containsKey(e)) {
                    violaciones.add(String.format("Envío %s aparece asignado y no asignado al mismo tiempo",
                            e.getId()));
                }
            }
        }

        List<Envio> giantTour = individuo.getRepresentacionGigante();
        if (giantTour == null) {
            violaciones.add("Representación gigante es null");
        } else {
            Set<Envio> vistos = new HashSet<>();
            for (Envio envio : giantTour) {
                if (envio != null && !vistos.add(envio)) {
                    violaciones.add(String.format("Representación gigante contiene duplicado: envío %s",
                            envio.getId()));
                }
            }

            Set<Envio> enTour = new HashSet<>(giantTour);
            for (Envio envio : asignados.keySet()) {
                if (!enTour.contains(envio)) {
                    violaciones.add(String.format("Envío asignado fuera del giant tour: %s", envio.getId()));
                }
            }
        }

        // 2. Verificar cada ruta asignada
        for (Map.Entry<Envio, RutaEnvio> entry : asignados.entrySet()) {
            Envio envio = entry.getKey();
            RutaEnvio ruta = entry.getValue();

            // Conectividad
            if (!validarConexiones(ruta)) {
                violaciones.add(String.format("Ruta desconectada para envío %s", envio.getId()));
            }

            // Deadline
            if (!validarDeadline(ruta)) {
                violaciones.add(String.format("Deadline violado para envío %s (retraso: %d min)",
                        envio.getId(), ruta.getRetraso()));
            }
        }

        // 3. Verificar capacidades de vuelos (acumular maletas por vuelo)
        Map<Vuelo, Integer> cargaPorVuelo = new HashMap<>();
        for (Map.Entry<Envio, RutaEnvio> entry : asignados.entrySet()) {
            Envio envio = entry.getKey();
            RutaEnvio ruta = entry.getValue();
            if (ruta.getSecuenciaVuelos() != null) {
                for (Vuelo v : ruta.getSecuenciaVuelos()) {
                    cargaPorVuelo.merge(v, envio.getCantidadMaletas(), Integer::sum);
                }
            }
        }

        for (Map.Entry<Vuelo, Integer> entry : cargaPorVuelo.entrySet()) {
            Vuelo vuelo = entry.getKey();
            int carga = entry.getValue();
            if (!validarCapacidadVuelo(vuelo, carga)) {
                violaciones.add(String.format("Capacidad excedida en %s→%s: %d/%d maletas disponibles",
                        vuelo.getAeropuertoOrigen().getCodigoICAO(),
                        vuelo.getAeropuertoDestino().getCodigoICAO(),
                        carga, vuelo.getCapacidadDisponible()));
            }
        }

        Map<String, Integer> cargaPorAeropuerto = new HashMap<>();
        if (individuo.getEnviosNoAsignados() != null) {
            for (Envio envio : individuo.getEnviosNoAsignados()) {
                if (envio.getAeropuertoOrigen() == null) {
                    continue;
                }
                cargaPorAeropuerto.merge(envio.getAeropuertoOrigen().getCodigoICAO(),
                        envio.getCantidadMaletas(), Integer::sum);
            }
        }

        for (Map.Entry<String, Integer> entry : cargaPorAeropuerto.entrySet()) {
            String icao = entry.getKey();
            int carga = entry.getValue();
            int capacidad = asignados.keySet().stream()
                    .map(Envio::getAeropuertoOrigen)
                    .filter(Objects::nonNull)
                    .filter(a -> icao.equals(a.getCodigoICAO()))
                    .mapToInt(a -> a.getCapacidadAlmacen())
                    .findFirst()
                    .orElseGet(() -> individuo.getEnviosNoAsignados().stream()
                            .map(Envio::getAeropuertoOrigen)
                            .filter(Objects::nonNull)
                            .filter(a -> icao.equals(a.getCodigoICAO()))
                            .mapToInt(a -> a.getCapacidadAlmacen())
                            .findFirst()
                            .orElse(0));
            if (capacidad > 0 && carga > capacidad) {
                violaciones.add(String.format("Almacén excedido en %s: %d/%d maletas pendientes",
                        icao, carga, capacidad));
            }
        }

        return violaciones;
    }

    /**
     * Determina si un individuo es completamente factible.
     */
    public boolean esFactible(Individuo individuo) {
        return validarIndividuo(individuo).isEmpty();
    }
}

