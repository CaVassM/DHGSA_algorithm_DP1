package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;

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
