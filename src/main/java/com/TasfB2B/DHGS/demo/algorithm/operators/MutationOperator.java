package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;

/**
 * Interfaz para operadores de mutación.
 * La mutación introduce variaciones aleatorias en un individuo.
 */
public interface MutationOperator {

    /**
     * Aplica una mutación al individuo.
     *
     * @param individuo individuo a mutar
     * @return individuo mutado (puede ser nuevo o el mismo modificado)
     */
    Individuo mutar(Individuo individuo);
}
