package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.*;

/**
 * Operador DELETE: remueve envíos opcionales que causan violaciones.
 *
 * Para cada envío OPCIONAL asignado: si quitarlo mejora el fitness → quitarlo.
 * Nunca remueve must-go.
 */
public class LocalSearchDelete implements LocalSearch {

    @Override
    public Individuo aplicar(Individuo individuo) {
        return individuo.clonar();
    }

    @Override
    public Individuo aplicar(Individuo individuo, LocalSearchContext ctx) {
        Individuo mejor = individuo.clonar();
        ctx.evaluar(mejor);
        double mejorFitness = mejor.getFitness();

        boolean huboMejora = true;
        while (huboMejora) {
            huboMejora = false;

            List<Envio> opcionales = new ArrayList<>();
            for (Envio e : mejor.getEnviosAsignados().keySet()) {
                if (!e.isEsMustGo()) {
                    opcionales.add(e);
                }
            }

            for (Envio candidato : opcionales) {
                Individuo prueba = mejor.clonar();
                RutaEnvio rutaRemovida = prueba.getEnviosAsignados().remove(candidato);
                if (rutaRemovida != null) {
                    if (!prueba.getEnviosNoAsignados().contains(candidato)) {
                        prueba.getEnviosNoAsignados().add(candidato);
                    }
                    prueba.setRepresentacionGigante(
                            ctx.removerDelTour(prueba.getRepresentacionGigante(), candidato));
                }

                double fitnessPrueba = ctx.evaluar(prueba);

                if (fitnessPrueba < mejorFitness) {
                    mejor = prueba;
                    mejorFitness = fitnessPrueba;
                    huboMejora = true;
                    break;
                }
            }
        }

        return mejor;
    }

    @Override
    public String getNombre() {
        return "DELETE - Remover envíos opcionales problemáticos";
    }
}
