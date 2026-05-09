package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.*;

/**
 * Operador RELOCATE: mueve un envío a otra posición del giant tour.
 * Re-aplica SPLIT y evalúa si el movimiento mejora fitness.
 */
public class LocalSearchRelocate implements LocalSearch {

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

        for (int i = 0; i < tour.size(); i++) {
            for (int j = 0; j < tour.size(); j++) {
                if (i == j) continue;

                Individuo prueba = mejor.clonar();
                List<Envio> nuevoTour = new ArrayList<>(prueba.getRepresentacionGigante());

                // Remover de posición i e insertar en posición j
                Envio movido = nuevoTour.remove(i);
                nuevoTour.add(j < nuevoTour.size() ? j : nuevoTour.size(), movido);
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
        return "RELOCATE - Mover envío a diferente posición en ruta";
    }
}
