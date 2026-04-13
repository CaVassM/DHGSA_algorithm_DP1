package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;

/**
 * Interfaz para operadores de cruce (crossover).
 * El crossover combina dos padres para producir un hijo.
 */
public interface CrossoverOperator {

    /**
     * Realiza el cruce entre dos padres y produce un hijo.
     *
     * @param padre1 primer padre
     * @param padre2 segundo padre
     * @return nuevo individuo hijo
     */
    Individuo cruzar(Individuo padre1, Individuo padre2);
}
