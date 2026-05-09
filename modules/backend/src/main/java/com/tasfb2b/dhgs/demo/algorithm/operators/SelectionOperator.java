package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;

import java.util.List;

/**
 * Interfaz para operadores de selección.
 * La selección elige individuos de la población para reproducción.
 */
public interface SelectionOperator {

    /**
     * Selecciona un individuo de la población.
     *
     * @param poblacion lista de candidatos
     * @return individuo seleccionado
     */
    Individuo seleccionar(List<Individuo> poblacion);
}
