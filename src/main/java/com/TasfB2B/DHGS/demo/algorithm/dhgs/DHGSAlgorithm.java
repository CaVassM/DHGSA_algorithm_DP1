package com.TasfB2B.DHGS.demo.algorithm.dhgs;

import com.TasfB2B.DHGS.demo.algorithm.operators.*;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.valueobject.ParametrosPenalizacion;
import com.TasfB2B.DHGS.demo.infraestructure.util.AlgoritmoSPLIT;
import com.TasfB2B.DHGS.demo.infraestructure.util.CalculadorFitness;
import com.TasfB2B.DHGS.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.TasfB2B.DHGS.demo.infraestructure.util.Validador;
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
        while (true) {
            iteracion++;

            Duration transcurrido = Duration.between(inicio, Instant.now());
            if (transcurrido.compareTo(limiteTiempo) >= 0) {
                break;
            }

            if (poblacion.estaEstancada(0.001)) {
                log.info("Población estancada en iteración {}", iteracion);
                break;
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

        Individuo mejor = poblacion.getMejorHistorico();
        if (mejor == null && !poblacion.getFactibles().isEmpty()) {
            mejor = poblacion.getFactibles().stream()
                    .min(Comparator.comparingDouble(Individuo::getFitness))
                    .orElse(null);
        }
        if (mejor == null && !poblacion.getInfactibles().isEmpty()) {
            mejor = poblacion.getInfactibles().stream()
                    .min(Comparator.comparingDouble(Individuo::getFitness))
                    .orElse(null);
        }

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
}
