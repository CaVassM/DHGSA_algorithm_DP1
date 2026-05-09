package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;

/**
 * Interfaz base para todos los operadores de búsqueda local.
 * Cada implementación mejora un individuo mediante un tipo específico de movimiento.
 */
public interface LocalSearch {

    /**
     * Aplica la búsqueda local al individuo.
     *
     * @param individuo individuo a mejorar
     * @return individuo mejorado (puede ser nuevo o el mismo modificado)
     */
    Individuo aplicar(Individuo individuo);

    /**
     * Aplica la búsqueda local con contexto (acceso a SPLIT y fitness).
     * Implementación por defecto delega al método sin contexto.
     */
    default Individuo aplicar(Individuo individuo, LocalSearchContext ctx) {
        return aplicar(individuo);
    }

    /**
     * Retorna el nombre descriptivo del operador.
     */
    String getNombre();
}
