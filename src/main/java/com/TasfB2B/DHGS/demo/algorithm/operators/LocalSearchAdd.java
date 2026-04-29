package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.*;

/**
 * Operador ADD: inserta envíos no asignados en la mejor posición posible.
 *
 * Para cada envío no asignado: buscar ruta vía SPLIT, si insertarlo
 * no empeora el fitness → insertarlo. Prioriza must-go.
 */
public class LocalSearchAdd implements LocalSearch {

    @Override
    public Individuo aplicar(Individuo individuo) {
        return individuo.clonar();
    }

    @Override
    public Individuo aplicar(Individuo individuo, LocalSearchContext ctx) {
        Individuo mejor = individuo.clonar();
        ctx.evaluar(mejor);
        double mejorFitness = mejor.getFitness();

        // Priorizar must-go primero, luego por prioridad
        List<Envio> candidatos = new ArrayList<>(mejor.getEnviosNoAsignados());
        candidatos.sort((a, b) -> {
            if (a.isEsMustGo() != b.isEsMustGo()) return a.isEsMustGo() ? -1 : 1;
            return Integer.compare(b.getPrioridad(), a.getPrioridad());
        });

        boolean huboMejora = true;
        while (huboMejora) {
            huboMejora = false;

            for (Envio candidato : new ArrayList<>(candidatos)) {
                // Buscar ruta para este envío
                RutaEnvio ruta = ctx.getSplit().asignarMejorRuta(candidato);
                if (ruta == null) continue;

                Individuo prueba = mejor.clonar();
                prueba.getEnviosAsignados().put(candidato, ruta);
                prueba.getEnviosNoAsignados().remove(candidato);
                prueba.setRepresentacionGigante(
                        ctx.agregarAlTour(prueba.getRepresentacionGigante(), candidato));

                double fitnessPrueba = ctx.evaluar(prueba);

                // Aceptar si mejora o si es must-go (forzar inserción)
                if (fitnessPrueba < mejorFitness || candidato.isEsMustGo()) {
                    mejor = prueba;
                    mejorFitness = fitnessPrueba;
                    candidatos.remove(candidato);
                    huboMejora = true;
                    break;
                }
            }
        }

        return mejor;
    }

    @Override
    public String getNombre() {
        return "ADD - Insertar envíos no asignados";
    }
}
