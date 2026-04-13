package com.TasfB2B.DHGS.demo.infraestructure.util;

import com.TasfB2B.DHGS.demo.domain.model.Aeropuerto;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Grafo dirigido de vuelos.
 * Los nodos son aeropuertos (código ICAO) y los arcos son vuelos programados.
 * Provee algoritmos de camino más corto (Dijkstra) para asignación de rutas.
 */
@Component
public class GrafoVuelos {

    /** Mapa de adyacencia: código ICAO → lista de vuelos salientes */
    private Map<String, List<Vuelo>> adyacencia;

    /** Mapa de aeropuertos por código ICAO */
    private Map<String, Aeropuerto> aeropuertos;

    /** Matriz de distancias precalculada (ICAO_origen → ICAO_destino → distancia km) */
    private Map<String, Map<String, Double>> matrizDistancias;

    public GrafoVuelos() {
        this.adyacencia = new HashMap<>();
        this.aeropuertos = new HashMap<>();
        this.matrizDistancias = new HashMap<>();
    }

    // --- Getters ---
    public Map<String, List<Vuelo>> getAdyacencia() { return adyacencia; }
    public Map<String, Aeropuerto> getAeropuertos() { return aeropuertos; }
    public Map<String, Map<String, Double>> getMatrizDistancias() { return matrizDistancias; }

    /**
     * Construye el grafo a partir de listas de aeropuertos y vuelos.
     */
    public void construir(List<Aeropuerto> listaAeropuertos, List<Vuelo> listaVuelos) {
        this.adyacencia.clear();
        this.aeropuertos.clear();
        this.matrizDistancias.clear();

        // Registrar aeropuertos
        for (Aeropuerto a : listaAeropuertos) {
            aeropuertos.put(a.getCodigoICAO(), a);
            adyacencia.put(a.getCodigoICAO(), new ArrayList<>());
        }

        // Registrar vuelos como arcos
        for (Vuelo v : listaVuelos) {
            String origenICAO = v.getAeropuertoOrigen().getCodigoICAO();
            // Si no existe un aeropuertoc on ese codigo ICAO, entonces se crea un array, caso contrario,
            // se agrega el vuelo a la lista de vuelos salientes
            adyacencia.computeIfAbsent(origenICAO, k -> new ArrayList<>()).add(v);
        }

        // Precalcular matriz de distancias
        calcularMatrizDistancias(listaAeropuertos);
    }

    /**
     * Obtiene todos los vuelos que salen de un aeropuerto.
     */
    public List<Vuelo> obtenerVuelosSalientes(String codigoICAO) {
        // getOrDefault indica dar lista de vuelos que salen de ese aeropuerto, caso contrario, devuelve un alista vacia
        return adyacencia.getOrDefault(codigoICAO, Collections.emptyList());
    }

    /**
     * Encuentra la ruta más corta (menor tiempo total) entre dos aeropuertos
     * usando Dijkstra sobre el grafo de vuelos.
     *
     * @return lista ordenada de vuelos que componen la ruta, o lista vacía si no hay conexión
     */
    public List<Vuelo> dijkstraMenorTiempo(Aeropuerto origen, Aeropuerto destino) {
        if (origen == null || destino == null) return Collections.emptyList();

        String origenICAO = origen.getCodigoICAO();
        String destinoICAO = destino.getCodigoICAO();

        // Dijkstra: nodo = código ICAO, peso = duración en minutos
        Map<String, Long> distancias = new HashMap<>();
        Map<String, Vuelo> predecesores = new HashMap<>(); // Para reconstruir ruta
        Set<String> visitados = new HashSet<>();

        // PriorityQueue: (tiempo acumulado, código ICAO)
        PriorityQueue<long[]> cola = new PriorityQueue<>(Comparator.comparingLong(a -> a[0]));

        // Inicializar distancias como infinito
        for (String icao : adyacencia.keySet()) {
            distancias.put(icao, Long.MAX_VALUE);
        }
        distancias.put(origenICAO, 0L);

        // Usar hash del ICAO como identificador en la cola
        Map<String, Integer> icaoToIndex = new HashMap<>();
        List<String> indexToIcao = new ArrayList<>(adyacencia.keySet());
        for (int i = 0; i < indexToIcao.size(); i++) {
            icaoToIndex.put(indexToIcao.get(i), i);
        }

        Integer origenIdx = icaoToIndex.get(origenICAO);
        if (origenIdx == null) return Collections.emptyList();

        cola.offer(new long[]{0L, origenIdx});

        while (!cola.isEmpty()) {
            long[] actual = cola.poll();
            long tiempoActual = actual[0];
            int idx = (int) actual[1];
            String icaoActual = indexToIcao.get(idx);

            if (visitados.contains(icaoActual)) continue;
            visitados.add(icaoActual);

            // Si llegamos al destino, reconstruir ruta
            if (icaoActual.equals(destinoICAO)) {
                return reconstruirRuta(predecesores, origenICAO, destinoICAO);
            }

            // Explorar vuelos salientes
            for (Vuelo vuelo : obtenerVuelosSalientes(icaoActual)) {
                String vecino = vuelo.getAeropuertoDestino().getCodigoICAO();
                if (visitados.contains(vecino)) continue;

                long tiempoVuelo = vuelo.getTiempoVuelo();
                long nuevoTiempo = tiempoActual + tiempoVuelo;

                if (nuevoTiempo < distancias.getOrDefault(vecino, Long.MAX_VALUE)) {
                    distancias.put(vecino, nuevoTiempo);
                    predecesores.put(vecino, vuelo);
                    Integer vecinoIdx = icaoToIndex.get(vecino);
                    if (vecinoIdx != null) {
                        cola.offer(new long[]{nuevoTiempo, vecinoIdx});
                    }
                }
            }
        }

        return Collections.emptyList(); // No hay ruta
    }

    /**
     * Encuentra las K rutas más cortas entre dos aeropuertos.
     * Usa variante de Yen's K-shortest paths simplificada.
     *
     * @return lista de rutas (cada ruta es una lista de vuelos), ordenadas por tiempo
     */
    public List<List<Vuelo>> encontrarKRutas(Aeropuerto origen, Aeropuerto destino, int k) {
        List<List<Vuelo>> rutas = new ArrayList<>();

        // Primera ruta: Dijkstra normal
        List<Vuelo> rutaMasCorta = dijkstraMenorTiempo(origen, destino);
        if (rutaMasCorta.isEmpty()) return rutas;

        rutas.add(rutaMasCorta);

        // Para k > 1: generar rutas alternativas eliminando arcos
        // TODO: Implementar Yen's K-shortest paths completo
        // Por ahora retornamos solo la ruta principal
        if (k <= 1) return rutas;

        // Buscar rutas alternativas explorando vecinos intermedios
        for (String icaoIntermedio : adyacencia.keySet()) {
            if (icaoIntermedio.equals(origen.getCodigoICAO()) ||
                icaoIntermedio.equals(destino.getCodigoICAO())) continue;

            Aeropuerto intermedio = aeropuertos.get(icaoIntermedio);
            if (intermedio == null) continue;

            List<Vuelo> tramo1 = dijkstraMenorTiempo(origen, intermedio);
            List<Vuelo> tramo2 = dijkstraMenorTiempo(intermedio, destino);

            if (!tramo1.isEmpty() && !tramo2.isEmpty()) {
                List<Vuelo> rutaAlternativa = new ArrayList<>(tramo1);
                rutaAlternativa.addAll(tramo2);
                rutas.add(rutaAlternativa);
            }

            if (rutas.size() >= k) break;
        }

        // Ordenar por tiempo total
        rutas.sort(Comparator.comparingLong(ruta ->
                ruta.stream().mapToLong(Vuelo::getTiempoVuelo).sum()));

        return rutas.subList(0, Math.min(k, rutas.size()));
    }

    /**
     * Obtiene la distancia precalculada entre dos aeropuertos.
     */
    public double getDistancia(String origenICAO, String destinoICAO) {
        // Devuelve fila del aeropuerto origen
        // Si no, se devuelve un mapa vacio
        // El 2do es, dentro de la fila, dar la distancai al destino
        // caso contrario, un valor enorme para indicar que no hay conexión directa
        return matrizDistancias
                .getOrDefault(origenICAO, Collections.emptyMap())
                .getOrDefault(destinoICAO, Double.MAX_VALUE);
    }

    /**
     * Verifica si existe al menos una ruta entre dos aeropuertos.
     */
    public boolean existeConexion(String origenICAO, String destinoICAO) {
        Aeropuerto origen = aeropuertos.get(origenICAO);
        Aeropuerto destino = aeropuertos.get(destinoICAO);
        if (origen == null || destino == null) return false;
        return !dijkstraMenorTiempo(origen, destino).isEmpty();
    }

    // --- Métodos privados ---

    /**
     * Reconstruye la ruta de vuelos desde origen hasta destino usando el mapa de predecesores.
     */
    private List<Vuelo> reconstruirRuta(Map<String, Vuelo> predecesores, String origenICAO, String destinoICAO) {
        List<Vuelo> ruta = new ArrayList<>();
        String actual = destinoICAO;

        while (!actual.equals(origenICAO) && predecesores.containsKey(actual)) {
            Vuelo vuelo = predecesores.get(actual);
            ruta.add(vuelo);
            actual = vuelo.getAeropuertoOrigen().getCodigoICAO();
        }

        Collections.reverse(ruta);
        return ruta;
    }

    /**
     * Precalcula la matriz de distancias Haversine entre todos los pares de aeropuertos.
     */
    private void calcularMatrizDistancias(List<Aeropuerto> listaAeropuertos) {
        for (Aeropuerto a : listaAeropuertos) {
            Map<String, Double> fila = new HashMap<>();
            for (Aeropuerto b : listaAeropuertos) {
                fila.put(b.getCodigoICAO(), a.getDistanciaA(b));
            }
            matrizDistancias.put(a.getCodigoICAO(), fila);
        }
        // SPIM → SCEL -> 2500 km
    }

    @Override
    public String toString() {
        return String.format("GrafoVuelos[aeropuertos=%d, vuelosTotales=%d]",
                aeropuertos.size(),
                adyacencia.values().stream().mapToInt(List::size).sum());
    }
}

