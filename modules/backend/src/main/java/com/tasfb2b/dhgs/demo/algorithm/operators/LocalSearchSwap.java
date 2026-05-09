package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.*;

/**
 * Operador SWAP: intercambia dos envíos de posición en el giant tour.
 * Re-aplica SPLIT y evalúa si la nueva permutación mejora fitness.
 */
public class LocalSearchSwap implements LocalSearch {

    @Override
    public Individuo aplicar(Individuo individuo) {
        return individuo.clonar();
    }

    @Override
    public Individuo aplicar(Individuo individuo, LocalSearchContext ctx) {
        Individuo mejor = individuo.clonar();
        ctx.evaluar(mejor);
        double mejorFitness = mejor.getFitness();

        List<Envio> tour = mejor.getRepresentacionGigante();
        if (tour == null || tour.size() < 2) return mejor;

        for (int i = 0; i < tour.size() - 1; i++) {
            for (int j = i + 1; j < tour.size(); j++) {
                Individuo prueba = mejor.clonar();
                List<Envio> nuevoTour = new ArrayList<>(prueba.getRepresentacionGigante());

                // Swap posiciones i y j
                Collections.swap(nuevoTour, i, j);
                prueba.setRepresentacionGigante(nuevoTour);

                // Re-SPLIT
                Map<Envio, RutaEnvio> asignaciones = ctx.getSplit().split(nuevoTour);
                prueba.setEnviosAsignados(asignaciones);

                prueba.setEnviosNoAsignados(ctx.construirNoAsignados(asignaciones));

                double fitnessPrueba = ctx.evaluar(prueba);

                if (fitnessPrueba < mejorFitness) {
                    mejor = prueba;
                    mejorFitness = fitnessPrueba;
                    return mejor; // first-improvement
                }
            }
        }

        return mejor;
    }

    @Override
    public String getNombre() {
        return "SWAP - Intercambiar dos envíos de posición";
    }
}
