package com.TasfB2B.DHGS.demo.algorithm.ialns;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.InstanciaVuelo;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

public final class IALNSSolutionSupport {

    private IALNSSolutionSupport() {
    }

    public static void normalizarSolucion(Individuo solucion) {
        if (solucion == null) {
            return;
        }

        if (solucion.getEnviosAsignados() == null) {
            solucion.setEnviosAsignados(new LinkedHashMap<>());
        }
        if (solucion.getEnviosNoAsignados() == null) {
            solucion.setEnviosNoAsignados(new ArrayList<>());
        }
        if (solucion.getRepresentacionGigante() == null) {
            solucion.setRepresentacionGigante(new ArrayList<>());
        }

        LinkedHashSet<Envio> orden = new LinkedHashSet<>();
        solucion.getRepresentacionGigante().stream().filter(Objects::nonNull).forEach(orden::add);
        solucion.getEnviosAsignados().keySet().stream().filter(Objects::nonNull).forEach(orden::add);
        solucion.getEnviosNoAsignados().stream().filter(Objects::nonNull).forEach(orden::add);

        solucion.setRepresentacionGigante(new ArrayList<>(orden));

        List<Envio> noAsignados = orden.stream()
                .filter(envio -> !solucion.getEnviosAsignados().containsKey(envio))
                .collect(Collectors.toCollection(ArrayList::new));
        solucion.setEnviosNoAsignados(noAsignados);
    }

    public static List<Envio> obtenerEnviosAsignados(Individuo solucion) {
        if (solucion == null || solucion.getEnviosAsignados() == null || solucion.getEnviosAsignados().isEmpty()) {
            return new ArrayList<>();
        }
        return new ArrayList<>(solucion.getEnviosAsignados().keySet());
    }

    public static Map<String, List<Map.Entry<Envio, RutaEnvio>>> agruparPorRuta(Individuo solucion) {
        Map<String, List<Map.Entry<Envio, RutaEnvio>>> grupos = new LinkedHashMap<>();
        if (solucion == null || solucion.getEnviosAsignados() == null) {
            return grupos;
        }

        for (Map.Entry<Envio, RutaEnvio> entry : solucion.getEnviosAsignados().entrySet()) {
            String firma = firmaRuta(entry.getValue());
            grupos.computeIfAbsent(firma, key -> new ArrayList<>()).add(entry);
        }
        return grupos;
    }

    public static String firmaRuta(RutaEnvio ruta) {
        if (ruta == null || ruta.getSecuenciaVuelos() == null || ruta.getSecuenciaVuelos().isEmpty()) {
            return "RUTA_VACIA";
        }

        return ruta.getSecuenciaVuelos().stream()
                .map(IALNSSolutionSupport::firmaVuelo)
                .collect(Collectors.joining("|"));
    }

    public static double costoCompuestoGrupo(List<Map.Entry<Envio, RutaEnvio>> grupo) {
        if (grupo == null || grupo.isEmpty()) {
            return 0.0;
        }

        double distanciaPromedio = grupo.stream()
                .map(Map.Entry::getValue)
                .filter(Objects::nonNull)
                .mapToDouble(RutaEnvio::getDistanciaTotal)
                .average()
                .orElse(0.0);
        double esperaPromedio = grupo.stream()
                .map(Map.Entry::getValue)
                .filter(Objects::nonNull)
                .mapToDouble(IALNSSolutionSupport::calcularTiempoEsperaPromedio)
                .average()
                .orElse(0.0);

        return (distanciaPromedio * 0.7) + (esperaPromedio * 0.3);
    }

    public static double tiempoPenalizadoGrupo(List<Map.Entry<Envio, RutaEnvio>> grupo) {
        if (grupo == null || grupo.isEmpty()) {
            return 0.0;
        }

        double esperaPromedio = grupo.stream()
                .map(Map.Entry::getValue)
                .filter(Objects::nonNull)
                .mapToDouble(IALNSSolutionSupport::calcularTiempoEsperaPromedio)
                .average()
                .orElse(0.0);

        double maxRetraso = grupo.stream()
                .map(Map.Entry::getValue)
                .filter(Objects::nonNull)
                .mapToDouble(RutaEnvio::getRetraso)
                .max()
                .orElse(0.0);

        return esperaPromedio + (maxRetraso * 10.0);
    }

    public static double calcularAhorroPorRemocion(int indice, List<Envio> ordenados) {
        if (ordenados == null || ordenados.isEmpty() || indice < 0 || indice >= ordenados.size()) {
            return 0.0;
        }

        Envio actual = ordenados.get(indice);
        Envio previo = indice > 0 ? ordenados.get(indice - 1) : null;
        Envio siguiente = indice + 1 < ordenados.size() ? ordenados.get(indice + 1) : null;
        return distanciaEnvios(previo, actual)
                + distanciaEnvios(actual, siguiente)
                - distanciaEnvios(previo, siguiente);
    }

    public static List<RutaEnvio> construirRutasCandidatas(Individuo solucion, Envio envio, IALNSContext ctx) {
        Map<String, RutaEnvio> candidatas = new LinkedHashMap<>();

        if (solucion != null && solucion.getEnviosAsignados() != null) {
            for (RutaEnvio actual : solucion.getEnviosAsignados().values()) {
                RutaEnvio adaptada = adaptarRutaAEnvio(actual, envio);
                if (adaptada != null) {
                    candidatas.putIfAbsent(firmaRuta(adaptada), adaptada);
                }
            }
        }

        RutaEnvio mejorRuta = ctx.asignarMejorRuta(envio);
        if (mejorRuta != null) {
            candidatas.putIfAbsent(firmaRuta(mejorRuta), mejorRuta);
        }

        return new ArrayList<>(candidatas.values());
    }

    public static double evaluarInsercion(Individuo base, Envio envio, RutaEnvio candidata, IALNSContext ctx) {
        if (candidata == null) {
            return base.getFitness() + penalizacionNoAsignado(envio);
        }

        Individuo evaluada = base.clonar();
        insertarEnvio(evaluada, envio, candidata);
        ctx.evaluar(evaluada);
        return evaluada.getFitness();
    }

    public static void insertarEnvio(Individuo solucion, Envio envio, RutaEnvio candidata) {
        if (solucion == null || envio == null) {
            return;
        }
        if (solucion.getEnviosAsignados() == null) {
            solucion.setEnviosAsignados(new LinkedHashMap<>());
        }
        if (solucion.getEnviosNoAsignados() == null) {
            solucion.setEnviosNoAsignados(new ArrayList<>());
        }
        if (solucion.getRepresentacionGigante() == null) {
            solucion.setRepresentacionGigante(new ArrayList<>());
        }

        solucion.getEnviosAsignados().put(envio, candidata.clonar());
        solucion.getEnviosNoAsignados().remove(envio);
        if (!solucion.getRepresentacionGigante().contains(envio)) {
            solucion.getRepresentacionGigante().add(envio);
        }
    }

    public static void marcarNoAsignado(Individuo solucion, Envio envio) {
        if (solucion == null || envio == null) {
            return;
        }
        if (solucion.getEnviosAsignados() != null) {
            solucion.getEnviosAsignados().remove(envio);
        }
        if (solucion.getEnviosNoAsignados() == null) {
            solucion.setEnviosNoAsignados(new ArrayList<>());
        }
        if (!solucion.getEnviosNoAsignados().contains(envio)) {
            solucion.getEnviosNoAsignados().add(envio);
        }
        if (solucion.getRepresentacionGigante() == null) {
            solucion.setRepresentacionGigante(new ArrayList<>());
        }
        if (!solucion.getRepresentacionGigante().contains(envio)) {
            solucion.getRepresentacionGigante().add(envio);
        }
    }

    public static double calcularTiempoEsperaPromedio(RutaEnvio ruta) {
        if (ruta == null || ruta.getEnvio() == null || ruta.getSecuenciaVuelos() == null) {
            return 0.0;
        }
        RouteSimulation simulacion = simularRuta(ruta.getEnvio(), ruta.getSecuenciaVuelos());
        return simulacion.esValida ? simulacion.esperaPromedioMinutos : 0.0;
    }

    public static double penalizacionNoAsignado(Envio envio) {
        if (envio == null) {
            return 10000.0;
        }
        double costoEstimado = 0.0;
        if (envio.getAeropuertoOrigen() != null && envio.getAeropuertoDestino() != null) {
            costoEstimado = envio.getAeropuertoOrigen().getDistanciaA(envio.getAeropuertoDestino())
                    * Math.max(1, envio.getCantidadMaletas());
        }
        double factorMustGo = envio.isEsMustGo() ? 10.0 : 2.0;
        return Math.max(10000.0, costoEstimado * factorMustGo);
    }

    private static RutaEnvio adaptarRutaAEnvio(RutaEnvio base, Envio envio) {
        if (base == null || envio == null || base.getSecuenciaVuelos() == null || base.getSecuenciaVuelos().isEmpty()) {
            return null;
        }
        RouteSimulation simulacion = simularRuta(envio, base.getSecuenciaVuelos());
        if (!simulacion.esValida) {
            return null;
        }

        RutaEnvio candidata = new RutaEnvio();
        candidata.setEnvio(envio);
        candidata.setSecuenciaVuelos(new ArrayList<>(base.getSecuenciaVuelos()));
        candidata.calcularTiempos();
        return candidata.esFactible() ? candidata : null;
    }

    private static RouteSimulation simularRuta(Envio envio, List<Vuelo> vuelos) {
        if (envio == null || envio.getFechaHoraCreacion() == null || vuelos == null || vuelos.isEmpty()) {
            return RouteSimulation.invalida();
        }

        LocalDateTime referencia = envio.getFechaHoraCreacion();
        LocalDateTime tiempoInicio = null;
        LocalDateTime momentoActual = referencia;
        double distanciaTotal = 0.0;
        double esperaAcumulada = 0.0;
        int conexiones = 0;

        for (int indice = 0; indice < vuelos.size(); indice++) {
            Vuelo vuelo = vuelos.get(indice);
            LocalDateTime salida = obtenerSalidaProgramada(vuelo, momentoActual);
            LocalDateTime llegada = obtenerLlegadaProgramada(vuelo, momentoActual);
            if (salida == null || llegada == null || salida.isBefore(momentoActual) || llegada.isBefore(salida)) {
                return RouteSimulation.invalida();
            }

            if (indice == 0) {
                tiempoInicio = salida;
            } else {
                esperaAcumulada += Duration.between(momentoActual, salida).toMinutes();
                conexiones++;
            }

            momentoActual = llegada;
            distanciaTotal += vuelo.getDistancia();
        }

        if (envio.getDeadline() != null && momentoActual.isAfter(envio.getDeadline())) {
            return RouteSimulation.invalida();
        }

        double esperaPromedio = conexiones > 0 ? esperaAcumulada / conexiones : 0.0;
        return new RouteSimulation(true, tiempoInicio, momentoActual, distanciaTotal, esperaPromedio);
    }

    private static LocalDateTime obtenerSalidaProgramada(Vuelo vuelo, LocalDateTime referencia) {
        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraSalida() != null) {
            return instancia.getFechaHoraSalida();
        }
        LocalTime horaSalida = vuelo.getHoraSalida();
        if (horaSalida == null) {
            return null;
        }
        LocalDateTime salida = LocalDateTime.of(referencia.toLocalDate(), horaSalida);
        while (salida.isBefore(referencia)) {
            salida = salida.plusDays(1);
        }
        return salida;
    }

    private static LocalDateTime obtenerLlegadaProgramada(Vuelo vuelo, LocalDateTime referencia) {
        if (vuelo instanceof InstanciaVuelo instancia && instancia.getFechaHoraLlegada() != null) {
            return instancia.getFechaHoraLlegada();
        }
        LocalDateTime salida = obtenerSalidaProgramada(vuelo, referencia);
        if (salida == null) {
            return null;
        }
        Duration duracion = vuelo.getDuracion() != null
                ? vuelo.getDuracion()
                : Duration.ofMinutes(vuelo.getTiempoVuelo());
        return salida.plus(duracion);
    }

    private static String firmaVuelo(Vuelo vuelo) {
        String id = vuelo.getId();
        if (id != null && !id.isBlank()) {
            return id;
        }
        String origen = vuelo.getAeropuertoOrigen() != null ? vuelo.getAeropuertoOrigen().getCodigoICAO() : "NULL";
        String destino = vuelo.getAeropuertoDestino() != null ? vuelo.getAeropuertoDestino().getCodigoICAO() : "NULL";
        String salida = vuelo.getHoraSalida() != null ? vuelo.getHoraSalida().toString() : "NULL";
        return origen + "->" + destino + "@" + salida;
    }

    private static double distanciaEnvios(Envio a, Envio b) {
        if (a == null || b == null || a.getAeropuertoDestino() == null || b.getAeropuertoDestino() == null) {
            return 0.0;
        }
        return a.getAeropuertoDestino().getDistanciaA(b.getAeropuertoDestino());
    }

    private record RouteSimulation(
            boolean esValida,
            LocalDateTime tiempoInicio,
            LocalDateTime tiempoFin,
            double distanciaTotal,
            double esperaPromedioMinutos) {

        private static RouteSimulation invalida() {
            return new RouteSimulation(false, null, null, 0.0, 0.0);
        }
    }
}