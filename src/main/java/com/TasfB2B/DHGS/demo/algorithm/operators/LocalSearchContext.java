package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.infraestructure.util.AlgoritmoSPLIT;
import com.TasfB2B.DHGS.demo.infraestructure.util.CalculadorFitness;

/**
 * Contexto compartido entre operadores de búsqueda local.
 * Provee acceso a SPLIT y CalculadorFitness para evaluación incremental.
 */
public class LocalSearchContext {

    private final AlgoritmoSPLIT split;
    private final CalculadorFitness fitness;
    private final int epocaActual;
    private final int totalEpocas;

    public LocalSearchContext(AlgoritmoSPLIT split, CalculadorFitness fitness,
                              int epocaActual, int totalEpocas) {
        this.split = split;
        this.fitness = fitness;
        this.epocaActual = epocaActual;
        this.totalEpocas = totalEpocas;
    }

    public AlgoritmoSPLIT getSplit() { return split; }
    public CalculadorFitness getFitness() { return fitness; }
    public int getEpocaActual() { return epocaActual; }
    public int getTotalEpocas() { return totalEpocas; }

    /** Evalúa violaciones + fitness de un individuo de una sola vez. */
    public double evaluar(com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo ind) {
        fitness.calcularViolaciones(ind);
        return fitness.calcular(ind, epocaActual, totalEpocas);
    }
}

