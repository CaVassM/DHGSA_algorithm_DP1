package com.tasfb2b.dhgs.demo.infraestructure.util;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;

/**
 * Grafo dirigido de vuelos.
 * Los nodos son aeropuertos (código ICAO) y los arcos son vuelos programados.
 * Para el horizonte operativo, los vuelos recurrentes se materializan como instancias diarias.
 */
@Component
public class GrafoVuelos {

    /** Mapa de adyacencia: código ICAO → lista de vuelos salientes */
    private Map<String, List<Vuelo>> adyacencia;

    /** Mapa de aeropuertos por código ICAO */
    private Map<String, Aeropuerto> aeropuertos;

    /** Matriz de distancias precalculada (ICAO_origen → ICAO_destino → distancia km) */
    private Map<String, Map<String, Double>> matrizDistancias;

    private LocalDate fechaInicioOperacion;
    private long horizonteDias;

    public GrafoVuelos() {
        this.adyacencia = new HashMap<>();
        this.aeropuertos = new HashMap<>();
        this.matrizDistancias = new HashMap<>();
        this.horizonteDias = 0;
    }

    public Map<String, List<Vuelo>> getAdyacencia() { return adyacencia; }
    public Map<String, Aeropuerto> getAeropuertos() { return aeropuertos; }
    public Map<String, Map<String, Double>> getMatrizDistancias() { return matrizDistancias; }
    public LocalDate getFechaInicioOperacion() { return fechaInicioOperacion; }
    public long getHorizonteDias() { return horizonteDias; }

    /**
     * Construcción simple del grafo, manteniendo compatibilidad con pruebas unitarias básicas.
     */
    public void construir(List<Aeropuerto> listaAeropuertos, List<Vuelo> listaVuelos) {
        this.fechaInicioOperacion = null;
        this.horizonteDias = 0;
        construirInterno(listaAeropuertos, listaVuelos);
    }

    /**
     * Construye el grafo materializando un horizonte de vuelos recurrentes diarios.
     */
    public void construir(List<Aeropuerto> listaAeropuertos, List<Vuelo> plantillasVuelo,
                          LocalDate fechaInicioOperacion, long horizonteDias) {
        this.fechaInicioOperacion = fechaInicioOperacion;
        this.horizonteDias = Math.max(1, horizonteDias);
        List<Vuelo> materializados = materializarVuelos(plantillasVuelo, fechaInicioOperacion, this.horizonteDias);
        construirInterno(listaAeropuertos, materializados);
    }

    public List<Vuelo> materializarVuelos(List<Vuelo> plantillasVuelo, LocalDate fechaInicioOperacion, long horizonteDias) {
        if (plantillasVuelo == null || plantillasVuelo.isEmpty()) {
            return Collections.emptyList();
        }
        if (fechaInicioOperacion == null) {
            return new ArrayList<>(plantillasVuelo);
        }

        List<Vuelo> materializados = new ArrayList<>();
        long dias = Math.max(1, horizonteDias);
        for (Vuelo vuelo : plantillasVuelo) {
            if (vuelo instanceof InstanciaVuelo) {
                materializados.add(vuelo);
                continue;
            }
            for (int offset = 0; offset < dias; offset++) {
                materializados.add(InstanciaVuelo.desdePlantilla(vuelo, fechaInicioOperacion.plusDays(offset)));
            }
        }
        return materializados;
    }

    private void construirInterno(List<Aeropuerto> listaAeropuertos, List<Vuelo> listaVuelos) {
        this.adyacencia.clear();
        this.aeropuertos.clear();
        this.matrizDistancias.clear();

        for (Aeropuerto a : listaAeropuertos) {
            aeropuertos.put(a.getCodigoICAO(), a);
            adyacencia.put(a.getCodigoICAO(), new ArrayList<>());
        }

        for (Vuelo v : listaVuelos) {
            String origenICAO = v.getAeropuertoOrigen().getCodigoICAO();
            adyacencia.computeIfAbsent(origenICAO, k -> new ArrayList<>()).add(v);
        }

        adyacencia.values().forEach(lista -> lista.sort(Comparator.comparing(this::obtenerSalidaOrdenable)));
        calcularMatrizDistancias(listaAeropuertos);
    }

    public List<Vuelo> obtenerVuelosSalientes(String codigoICAO, int cargaRequerida) {
        return adyacencia.getOrDefault(codigoICAO, Collections.emptyList()).stream()
                .filter(v -> v.estaDisponiblePara(cargaRequerida))
                .toList();
    }

    private List<Vuelo> obtenerVuelosSalientes(String codigoICAO, int cargaRequerida, LocalDateTime noAntesDe) {
        return adyacencia.getOrDefault(codigoICAO, Collections.emptyList()).stream()
                .filter(v -> v.estaDisponiblePara(cargaRequerida))
                .filter(v -> {
                    LocalDateTime salida = obtenerSalidaProgramada(v, noAntesDe);
                    return salida != null && !salida.isBefore(noAntesDe);
                })
                .toList();
    }

    public List<Vuelo> dijkstraMenorTiempo(Aeropuerto origen, Aeropuerto destino) {
        return dijkstraMenorTiempo(origen, destino, 0, referenciaOperativa());
    }

    public List<Vuelo> dijkstraMenorTiempo(Aeropuerto origen, Aeropuerto destino, int cargaRequerida) {
        return dijkstraMenorTiempo(origen, destino, cargaRequerida, referenciaOperativa());
    }

    public List<Vuelo> dijkstraMenorTiempo(Aeropuerto origen, Aeropuerto destino, int cargaRequerida, LocalDateTime salidaMinima) {
        if (origen == null || destino == null || salidaMinima == null) {
            return Collections.emptyList();
        }

        String origenICAO = origen.getCodigoICAO();
        String destinoICAO = destino.getCodigoICAO();

        Map<String, LocalDateTime> llegadaMasTemprana = new HashMap<>();
        Map<String, Vuelo> predecesores = new HashMap<>();
        PriorityQueue<EstadoRuta> cola = new PriorityQueue<>(Comparator.comparing(EstadoRuta::momento));

        for (String icao : adyacencia.keySet()) {
            llegadaMasTemprana.put(icao, LocalDateTime.MAX);
        }
        llegadaMasTemprana.put(origenICAO, salidaMinima);
        cola.offer(new EstadoRuta(origenICAO, salidaMinima));

        while (!cola.isEmpty()) {
            EstadoRuta actual = cola.poll();
            LocalDateTime mejorConocida = llegadaMasTemprana.get(actual.icao());
            if (mejorConocida != null && actual.momento().isAfter(mejorConocida)) {
                continue;
            }
            if (actual.icao().equals(destinoICAO)) {
                return reconstruirRuta(predecesores, origenICAO, destinoICAO);
            }

            for (Vuelo vuelo : obtenerVuelosSalientes(actual.icao(), cargaRequerida, actual.momento())) {
                LocalDateTime salida = obtenerSalidaProgramada(vuelo, actual.momento());
                LocalDateTime llegada = obtenerLlegadaProgramada(vuelo, actual.momento());
                if (salida == null || llegada == null || llegada.isBefore(salida)) {
                    continue;
                }

                String vecino = vuelo.getAeropuertoDestino().getCodigoICAO();
                LocalDateTime llegadaActual = llegadaMasTemprana.getOrDefault(vecino, LocalDateTime.MAX);
                if (llegada.isBefore(llegadaActual)) {
                    llegadaMasTemprana.put(vecino, llegada);
                    predecesores.put(vecino, vuelo);
                    cola.offer(new EstadoRuta(vecino, llegada));
                }
            }
        }

        return Collections.emptyList();
    }

    public List<List<Vuelo>> encontrarKRutas(Aeropuerto origen, Aeropuerto destino, int k) {
        return encontrarKRutas(origen, destino, k, 0, referenciaOperativa());
    }

    public List<List<Vuelo>> encontrarKRutas(Aeropuerto origen, Aeropuerto destino, int k, int cargaRequerida) {
        return encontrarKRutas(origen, destino, k, cargaRequerida, referenciaOperativa());
    }

    public List<List<Vuelo>> encontrarKRutas(Aeropuerto origen, Aeropuerto destino, int k,
                                             int cargaRequerida, LocalDateTime salidaMinima) {
        List<List<Vuelo>> rutas = new ArrayList<>();
        List<Vuelo> rutaMasCorta = dijkstraMenorTiempo(origen, destino, cargaRequerida, salidaMinima);
        if (rutaMasCorta.isEmpty()) return rutas;

        rutas.add(rutaMasCorta);
        if (k <= 1) return rutas;

        for (String icaoIntermedio : adyacencia.keySet()) {
            if (icaoIntermedio.equals(origen.getCodigoICAO()) || icaoIntermedio.equals(destino.getCodigoICAO())) {
                continue;
            }

            Aeropuerto intermedio = aeropuertos.get(icaoIntermedio);
            if (intermedio == null) continue;

            List<Vuelo> tramo1 = dijkstraMenorTiempo(origen, intermedio, cargaRequerida, salidaMinima);
            LocalDateTime llegadaIntermedia = obtenerLlegadaUltimoTramo(tramo1, salidaMinima);
            List<Vuelo> tramo2 = dijkstraMenorTiempo(intermedio, destino, cargaRequerida, llegadaIntermedia);

            if (!tramo1.isEmpty() && !tramo2.isEmpty()) {
                List<Vuelo> rutaAlternativa = new ArrayList<>(tramo1);
                rutaAlternativa.addAll(tramo2);
                rutas.add(rutaAlternativa);
            }

            if (rutas.size() >= k) break;
        }

        rutas.sort(Comparator.comparing(ruta -> obtenerTiempoTotalRuta(ruta, salidaMinima)));
        return rutas.subList(0, Math.min(k, rutas.size()));
    }

    public double getDistancia(String origenICAO, String destinoICAO) {
        return matrizDistancias
                .getOrDefault(origenICAO, Collections.emptyMap())
                .getOrDefault(destinoICAO, Double.MAX_VALUE);
    }

    public boolean existeConexion(String origenICAO, String destinoICAO) {
        Aeropuerto origen = aeropuertos.get(origenICAO);
        Aeropuerto destino = aeropuertos.get(destinoICAO);
        if (origen == null || destino == null) return false;
        return !dijkstraMenorTiempo(origen, destino).isEmpty();
    }

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

    private LocalDateTime obtenerSalidaProgramada(Vuelo vuelo, LocalDateTime referencia) {
        if (vuelo instanceof InstanciaVuelo instancia) {
            return instancia.getFechaHoraSalida();
        }
        if (vuelo.getHoraSalida() == null) {
            return null;
        }
        LocalDateTime base = LocalDateTime.of(referencia.toLocalDate(), vuelo.getHoraSalida());
        while (base.isBefore(referencia)) {
            base = base.plusDays(1);
        }
        return base;
    }

    private LocalDateTime obtenerLlegadaProgramada(Vuelo vuelo, LocalDateTime referencia) {
        if (vuelo instanceof InstanciaVuelo instancia) {
            return instancia.getFechaHoraLlegada();
        }
        LocalDateTime salida = obtenerSalidaProgramada(vuelo, referencia);
        if (salida == null) {
            return null;
        }
        return salida.plus(vuelo.getDuracion() != null ? vuelo.getDuracion() : java.time.Duration.ofMinutes(vuelo.getTiempoVuelo()));
    }

    private LocalDateTime obtenerSalidaOrdenable(Vuelo vuelo) {
        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraSalida() != null) {
            return instancia.getFechaHoraSalida();
        }
        LocalTime horaSalida = vuelo.getHoraSalida() != null ? vuelo.getHoraSalida() : LocalTime.MIDNIGHT;
        return LocalDateTime.of(referenciaOperativa().toLocalDate(), horaSalida);
    }

    private LocalDateTime obtenerLlegadaUltimoTramo(List<Vuelo> ruta, LocalDateTime referencia) {
        if (ruta == null || ruta.isEmpty()) {
            return referencia;
        }
        Vuelo ultimo = ruta.get(ruta.size() - 1);
        return obtenerLlegadaProgramada(ultimo, referencia);
    }

    private long obtenerTiempoTotalRuta(List<Vuelo> ruta, LocalDateTime referencia) {
        if (ruta == null || ruta.isEmpty()) {
            return Long.MAX_VALUE;
        }
        Vuelo primero = ruta.get(0);
        LocalDateTime salida = obtenerSalidaProgramada(primero, referencia);
        if (salida == null) {
            return Long.MAX_VALUE;
        }
        LocalDateTime llegada = salida;
        for (Vuelo vuelo : ruta) {
            llegada = obtenerLlegadaProgramada(vuelo, llegada);
            if (llegada == null) {
                return Long.MAX_VALUE;
            }
        }
        return java.time.Duration.between(salida, llegada).toMinutes();
    }

    private LocalDateTime referenciaOperativa() {
        if (fechaInicioOperacion != null) {
            return fechaInicioOperacion.atStartOfDay();
        }

        return adyacencia.values().stream()
                .flatMap(Collection::stream)
                .filter(InstanciaVuelo.class::isInstance)
                .map(InstanciaVuelo.class::cast)
                .map(InstanciaVuelo::getFechaHoraSalida)
                .filter(Objects::nonNull)
                .min(LocalDateTime::compareTo)
                .orElse(LocalDate.MIN.atStartOfDay());
    }

    private void calcularMatrizDistancias(List<Aeropuerto> listaAeropuertos) {
        for (Aeropuerto a : listaAeropuertos) {
            Map<String, Double> fila = new HashMap<>();
            for (Aeropuerto b : listaAeropuertos) {
                fila.put(b.getCodigoICAO(), a.getDistanciaA(b));
            }
            matrizDistancias.put(a.getCodigoICAO(), fila);
        }
    }

    @Override
    public String toString() {
        return String.format("GrafoVuelos[aeropuertos=%d, vuelosTotales=%d, inicio=%s, dias=%d]",
                aeropuertos.size(),
                adyacencia.values().stream().mapToInt(List::size).sum(),
                fechaInicioOperacion,
                horizonteDias);
    }

    private record EstadoRuta(String icao, LocalDateTime momento) {
    }
}
