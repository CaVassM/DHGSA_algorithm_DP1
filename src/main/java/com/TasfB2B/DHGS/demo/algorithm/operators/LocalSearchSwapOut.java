package com.TasfB2B.DHGS.demo.algorithm.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.*;

/**
 * Operador SWAP-OUT: intercambia un envío asignado (problemático) por uno no asignado.
 *
 * Para cada par (envío_dentro opcional, envío_fuera):
 * - Si intercambiarlos mejora fitness → aceptar.
 */
public class LocalSearchSwapOut implements LocalSearch {

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

            List<Envio> dentroOpcionales = new ArrayList<>();
            for (Envio e : mejor.getEnviosAsignados().keySet()) {
                if (!e.isEsMustGo()) dentroOpcionales.add(e);
            }
            List<Envio> fuera = new ArrayList<>(mejor.getEnviosNoAsignados());

            for (Envio eDentro : dentroOpcionales) {
                for (Envio eFuera : fuera) {
                    // Buscar ruta para el envío de fuera
                    RutaEnvio rutaNueva = ctx.getSplit().asignarMejorRuta(eFuera);
                    if (rutaNueva == null) continue;

                    Individuo prueba = mejor.clonar();
                    // Sacar el de dentro
                    prueba.getEnviosAsignados().remove(eDentro);
                    if (!prueba.getEnviosNoAsignados().contains(eDentro)) {
                        prueba.getEnviosNoAsignados().add(eDentro);
                    }
                    // Meter el de fuera
                    prueba.getEnviosAsignados().put(eFuera, rutaNueva);
                    prueba.getEnviosNoAsignados().remove(eFuera);
                    prueba.setRepresentacionGigante(
                            ctx.reemplazarEnTour(prueba.getRepresentacionGigante(), eDentro, eFuera));

                    double fitnessPrueba = ctx.evaluar(prueba);

                    if (fitnessPrueba < mejorFitness) {
                        mejor = prueba;
                        mejorFitness = fitnessPrueba;
                        huboMejora = true;
                        break;
                    }
                }
                if (huboMejora) break; // first-improvement
            }
        }

        return mejor;
    }

    @Override
    public String getNombre() {
        return "SWAP-OUT - Intercambiar envíos dentro/fuera de la solución";
    }
}
