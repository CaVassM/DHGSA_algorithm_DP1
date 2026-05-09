package com.tasfb2b.dhgs.demo.algorithm.dhgs;

import com.tasfb2b.dhgs.demo.algorithm.operators.*;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.valueobject.ParametrosPenalizacion;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Algoritmo principal DHGS (Dynamic Hybrid Genetic Search) adaptado a Tasf.B2B.
 * En este primer scope opera en condiciones ideales, sin cancelaciones de vuelos.
 */
public class DHGSAlgorithm {

    private static final Logger log = LoggerFactory.getLogger(DHGSAlgorithm.class);
    private static final int ITERACIONES_AJUSTE_PENALIZACION = 100;
    static final int MIN_ITERACIONES_ANTES_DIVERSIFICAR = 25;
    static final int VENTANA_ITERACIONES_DIVERSIFICACION = 12;
    static final double UMBRAL_DIVERSIDAD_ESTANCAMIENTO = 0.001;
    static final double UMBRAL_MEJORA_RELATIVA_MINIMA = 0.001;
    private static final double EPSILON_MEJORA_FITNESS = 1e-6;
    private static final double[] PROBABILIDADES_DIVERSIFICACION = {0.15, 0.35, 0.55, 0.85, 1.0};

    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;
    private final CrossoverOperator crossover;
    private final List<LocalSearch> operadoresLocalSearch;
    private final ParametrosPenalizacion parametros;

    public DHGSAlgorithm(ConstructorSolucionesIniciales constructorSoluciones,
                         AlgoritmoSPLIT split,
                         CalculadorFitness calculadorFitness,
                         Validador validador) {
        this.constructorSoluciones = constructorSoluciones;
        this.split = split;
        this.calculadorFitness = calculadorFitness;
        this.validador = validador;
        this.parametros = new ParametrosPenalizacion();
        this.crossover = new OXCrossover();
        this.operadoresLocalSearch = List.of(
                new LocalSearchDelete(),
                new LocalSearchAdd(),
                new LocalSearchSwapOut()
        );
    }

    /**
     * Ejecuta el algoritmo DHGS para una época.
     *
     * @param envios          todos los envíos disponibles (must-go + opcionales)
     * @param epocaActual     número de la época actual
     * @param totalEpocas     total de épocas
     * @param tamanoPoblacion tamaño de la población
     * @param limiteTiempo    límite de tiempo para la ejecución
     * @return mejor solución encontrada
     */
    public Individuo ejecutar(List<Envio> envios, int epocaActual, int totalEpocas,
                              int tamanoPoblacion, Duration limiteTiempo) {

        if (envios == null || envios.isEmpty()) {
            log.warn("DHGS invocado sin envíos para época {}", epocaActual);
            return null;
        }

        log.info("DHGS iniciando - Época {}/{}, {} envíos, límite: {}s",
                epocaActual, totalEpocas, envios.size(), limiteTiempo.getSeconds());

        Instant inicio = Instant.now();
        LocalSearchContext ctx = new LocalSearchContext(split, calculadorFitness, epocaActual, totalEpocas, envios);

        List<Individuo> poblacionInicial = constructorSoluciones.generarPoblacionInicial(
                envios, epocaActual, totalEpocas, tamanoPoblacion);

        Poblacion poblacion = new Poblacion();
        for (Individuo ind : poblacionInicial) {
            poblacion.agregar(ind);
        }

        log.info("Población inicial: {}", poblacion);

        int iteracion = 0;
        double mejorFitness = obtenerMejorFitness(poblacion);
        double fitnessReferenciaVentana = mejorFitness;
        int iteracionesEnVentana = 0;
        while (true) {
            iteracion++;
            iteracionesEnVentana++;

            Duration transcurrido = Duration.between(inicio, Instant.now());
            if (transcurrido.compareTo(limiteTiempo) >= 0) {
                break;
            }

            double mejoraRelativaVentana = calcularMejoraRelativa(fitnessReferenciaVentana, mejorFitness);
            if (debeDiversificarPorEstancamiento(iteracion, iteracionesEnVentana, mejoraRelativaVentana, poblacion,
                    UMBRAL_DIVERSIDAD_ESTANCAMIENTO, UMBRAL_MEJORA_RELATIVA_MINIMA)) {
                log.info("Población estancada en iteración {} (mejora relativa ventana: {}, diversidad: {}). Se inyectará diversidad.",
                        iteracion,
                        String.format(Locale.US, "%.6f", mejoraRelativaVentana),
                        poblacion.getDiversidad());
                diversificarPoblacion(envios, epocaActual, totalEpocas, tamanoPoblacion, poblacion);
                mejorFitness = obtenerMejorFitness(poblacion);
                fitnessReferenciaVentana = mejorFitness;
                iteracionesEnVentana = 0;
                continue;
            }

            try {
                Poblacion.Par<Individuo, Individuo> padres = poblacion.seleccionarPadres();
                Individuo hijo = crossover.cruzar(padres.primero(), padres.segundo());

                Map<Envio, RutaEnvio> asignaciones = split.split(hijo.getRepresentacionGigante());
                hijo.setEnviosAsignados(asignaciones);

                List<Envio> noAsignados = new ArrayList<>();
                for (Envio e : envios) {
                    if (!asignaciones.containsKey(e)) {
                        noAsignados.add(e);
                    }
                }
                hijo.setEnviosNoAsignados(noAsignados);

                for (LocalSearch ls : operadoresLocalSearch) {
                    hijo = ls.aplicar(hijo, ctx);
                }

                calculadorFitness.calcularViolaciones(hijo);
                calculadorFitness.calcular(hijo, epocaActual, totalEpocas);
                hijo.validarFactibilidad();
                poblacion.agregar(hijo);

                if (!esEstrictamenteFactible(hijo, validador)) {
                    Individuo reparado = repararHaciaFactibilidad(hijo, ctx);
                    if (difiereDe(hijo, reparado)) {
                        poblacion.agregar(reparado);
                    }
                }

                double mejorFitnessActual = obtenerMejorFitness(poblacion);
                if (mejorFitnessActual + EPSILON_MEJORA_FITNESS < mejorFitness) {
                    mejorFitness = mejorFitnessActual;
                }

                if (iteracion % ITERACIONES_AJUSTE_PENALIZACION == 0) {
                    parametros.ajustar(poblacion.getRatioFactibles());
                    calculadorFitness.setParametros(parametros);
                    log.debug("Iteración {}: ratio factibles={}, params={}",
                            iteracion, String.format("%.2f", poblacion.getRatioFactibles()), parametros);
                }

            } catch (Exception e) {
                log.warn("Error en iteración {}: {}", iteracion, e.getMessage());
            }
        }

        List<Individuo> candidatosRetorno = new ArrayList<>(poblacion.getTodos());
        if (poblacion.getMejorHistorico() != null) {
            candidatosRetorno.add(poblacion.getMejorHistorico());
        }
        Individuo mejor = seleccionarMejorRetorno(candidatosRetorno, validador);

        if (mejor != null) {
            mejor.validarFactibilidad();
            List<String> violaciones = validador.validarIndividuo(mejor);
            if (!violaciones.isEmpty()) {
                log.debug("Mejor individuo con {} observaciones de validación", violaciones.size());
            }
        }

        Duration tiempoTotal = Duration.between(inicio, Instant.now());
        log.info("DHGS finalizado - {} iteraciones en {}ms. Mejor: {}",
                iteracion, tiempoTotal.toMillis(), mejor);

        return mejor;
    }

    static Individuo seleccionarMejorRetorno(Collection<Individuo> candidatos, Validador validador) {
        if (candidatos == null || candidatos.isEmpty()) {
            return null;
        }

        return candidatos.stream()
                .filter(Objects::nonNull)
                .min(Comparator
                        .comparing((Individuo individuo) -> !esEstrictamenteFactible(individuo, validador))
                        .thenComparingDouble(Individuo::getFitness))
                .orElse(null);
    }

    static boolean esEstrictamenteFactible(Individuo individuo, Validador validador) {
        return individuo != null
                && individuo.validarFactibilidad()
                && (validador == null || validador.validarIndividuo(individuo).isEmpty());
    }

    Individuo repararHaciaFactibilidad(Individuo individuo, LocalSearchContext ctx) {
        if (individuo == null || ctx == null) {
            return individuo;
        }

        Individuo reparado = individuo.clonar();
        ctx.evaluar(reparado);
        List<String> violaciones = validador.validarIndividuo(reparado);

        while (!violaciones.isEmpty()) {
            Envio candidato = seleccionarOpcionalParaEliminar(reparado);
            if (candidato == null) {
                break;
            }

            reparado.getEnviosAsignados().remove(candidato);
            if (!reparado.getEnviosNoAsignados().contains(candidato)) {
                reparado.getEnviosNoAsignados().add(candidato);
            }
            reparado.setRepresentacionGigante(
                    ctx.removerDelTour(reparado.getRepresentacionGigante(), candidato));
            ctx.evaluar(reparado);
            violaciones = validador.validarIndividuo(reparado);
        }

        return reparado;
    }

    static boolean debeDiversificarPorEstancamiento(int iteracion,
                                                    int iteracionesEnVentana,
                                                    double mejoraRelativaVentana,
                                                    Poblacion poblacion,
                                                    double umbralDiversidad,
                                                    double umbralMejoraRelativa) {
        return iteracion >= MIN_ITERACIONES_ANTES_DIVERSIFICAR
                && iteracionesEnVentana >= VENTANA_ITERACIONES_DIVERSIFICACION
                && mejoraRelativaVentana <= umbralMejoraRelativa
                && poblacion != null
                && poblacion.estaEstancada(umbralDiversidad);
    }

    private void diversificarPoblacion(List<Envio> envios,
                                       int epocaActual,
                                       int totalEpocas,
                                       int tamanoPoblacion,
                                       Poblacion poblacion) {
        if (envios == null || envios.isEmpty() || poblacion == null) {
            return;
        }

        int cantidadNuevos = Math.max(2, Math.min(5, Math.max(1, tamanoPoblacion / 2)));
        Random random = new Random();

        for (int indice = 0; indice < cantidadNuevos; indice++) {
            double probabilidad = PROBABILIDADES_DIVERSIFICACION[indice % PROBABILIDADES_DIVERSIFICACION.length];
            Individuo nuevo = constructorSoluciones.generarAleatorio(
                    envios,
                    probabilidad,
                    epocaActual,
                    totalEpocas,
                    random);
            poblacion.agregar(nuevo);
        }
    }

    private static double obtenerMejorFitness(Poblacion poblacion) {
        if (poblacion == null) {
            return Double.POSITIVE_INFINITY;
        }
        if (poblacion.getMejorHistorico() != null) {
            return poblacion.getMejorHistorico().getFitness();
        }
        return poblacion.getTodos().stream()
                .mapToDouble(Individuo::getFitness)
                .min()
                .orElse(Double.POSITIVE_INFINITY);
    }

    static double calcularMejoraRelativa(double fitnessReferencia, double fitnessActual) {
        if (!Double.isFinite(fitnessReferencia) || fitnessReferencia <= 0.0 || !Double.isFinite(fitnessActual)) {
            return 0.0;
        }
        double mejora = fitnessReferencia - fitnessActual;
        if (mejora <= EPSILON_MEJORA_FITNESS) {
            return 0.0;
        }
        return mejora / fitnessReferencia;
    }

    private Envio seleccionarOpcionalParaEliminar(Individuo individuo) {
        if (individuo == null || individuo.getEnviosAsignados() == null || individuo.getEnviosAsignados().isEmpty()) {
            return null;
        }

        Set<RutaEnvio> rutasEnConflicto = new HashSet<>();
        Set<com.tasfb2b.dhgs.demo.domain.model.Vuelo> vuelosSobrecargados = obtenerVuelosSobrecargados(individuo);

        for (RutaEnvio ruta : individuo.getEnviosAsignados().values()) {
            if (ruta != null && !ruta.esFactible()) {
                rutasEnConflicto.add(ruta);
            }
        }

        return individuo.getEnviosAsignados().entrySet().stream()
                .filter(entry -> entry.getKey() != null && !entry.getKey().isEsMustGo())
                .sorted(Comparator
                        .comparingInt((Map.Entry<Envio, RutaEnvio> entry) -> rutasEnConflicto.contains(entry.getValue()) ? 0 : 1)
                        .thenComparingInt(entry -> usaVueloSobrecargado(entry.getValue(), vuelosSobrecargados) ? 0 : 1)
                        .thenComparing(Comparator.comparingInt((Map.Entry<Envio, RutaEnvio> entry) ->
                                Math.max(0, entry.getKey().getCantidadMaletas())).reversed())
                        .thenComparing(Comparator.comparingDouble((Map.Entry<Envio, RutaEnvio> entry) ->
                                entry.getValue() != null ? entry.getValue().getCosto() : 0.0).reversed())
                        .thenComparingInt(entry -> entry.getKey().getPrioridad()))
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse(null);
    }

    private Set<com.tasfb2b.dhgs.demo.domain.model.Vuelo> obtenerVuelosSobrecargados(Individuo individuo) {
        Map<com.tasfb2b.dhgs.demo.domain.model.Vuelo, Integer> cargaPorVuelo = new HashMap<>();
        for (Map.Entry<Envio, RutaEnvio> entry : individuo.getEnviosAsignados().entrySet()) {
            Envio envio = entry.getKey();
            RutaEnvio ruta = entry.getValue();
            if (envio == null || ruta == null || ruta.getSecuenciaVuelos() == null) {
                continue;
            }
            for (com.tasfb2b.dhgs.demo.domain.model.Vuelo vuelo : ruta.getSecuenciaVuelos()) {
                cargaPorVuelo.merge(vuelo, Math.max(0, envio.getCantidadMaletas()), Integer::sum);
            }
        }

        Set<com.tasfb2b.dhgs.demo.domain.model.Vuelo> vuelosSobrecargados = new HashSet<>();
        for (Map.Entry<com.tasfb2b.dhgs.demo.domain.model.Vuelo, Integer> entry : cargaPorVuelo.entrySet()) {
            if (entry.getKey() != null && entry.getValue() > entry.getKey().getCapacidadDisponible()) {
                vuelosSobrecargados.add(entry.getKey());
            }
        }
        return vuelosSobrecargados;
    }

    private boolean usaVueloSobrecargado(RutaEnvio ruta, Set<com.tasfb2b.dhgs.demo.domain.model.Vuelo> vuelosSobrecargados) {
        return ruta != null
                && ruta.getSecuenciaVuelos() != null
                && ruta.getSecuenciaVuelos().stream().anyMatch(vuelosSobrecargados::contains);
    }

    private boolean difiereDe(Individuo original, Individuo candidato) {
        if (original == null || candidato == null) {
            return false;
        }
        return !Objects.equals(original.getRepresentacionGigante(), candidato.getRepresentacionGigante())
                || !Objects.equals(original.getEnviosAsignados().keySet(), candidato.getEnviosAsignados().keySet())
                || !Objects.equals(original.getEnviosNoAsignados(), candidato.getEnviosNoAsignados())
                || Math.abs(original.getFitness() - candidato.getFitness()) > EPSILON_MEJORA_FITNESS;
    }
}
