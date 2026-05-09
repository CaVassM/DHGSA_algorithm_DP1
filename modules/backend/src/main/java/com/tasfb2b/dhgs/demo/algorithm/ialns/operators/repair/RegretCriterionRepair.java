package com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSContext;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSSolutionSupport;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.RepairOperator;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Random;

public class RegretCriterionRepair implements RepairOperator {

    @Override
    public Individuo reparar(Individuo solucionDestruida,
                             List<Envio> enviosRemovidos,
                             IALNSContext ctx,
                             int iteracion,
                             Random random) {
        List<Envio> pendientes = new ArrayList<>(enviosRemovidos);
        int k = 3 + (iteracion / 500);

        while (!pendientes.isEmpty()) {
            Envio elegido = null;
            RutaEnvio mejorRuta = null;
            double mayorRegret = Double.NEGATIVE_INFINITY;

            for (Envio envio : pendientes) {
                List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, envio, ctx).stream()
                        .sorted(Comparator.comparingDouble(ruta -> IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, ruta, ctx)))
                        .toList();

                double regret;
                RutaEnvio mejorCandidata = candidatas.isEmpty() ? null : candidatas.getFirst();

                if (candidatas.isEmpty()) {
                    regret = IALNSSolutionSupport.penalizacionNoAsignado(envio);
                } else {
                    double mejorCosto = IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, candidatas.getFirst(), ctx);
                    regret = 0.0;
                    for (int indice = 1; indice < Math.min(k, candidatas.size()); indice++) {
                        regret += IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, candidatas.get(indice), ctx) - mejorCosto;
                    }
                }

                if (regret > mayorRegret) {
                    mayorRegret = regret;
                    elegido = envio;
                    mejorRuta = mejorCandidata;
                }
            }

            if (elegido == null) {
                break;
            }

            if (mejorRuta == null) {
                IALNSSolutionSupport.marcarNoAsignado(solucionDestruida, elegido);
            } else {
                IALNSSolutionSupport.insertarEnvio(solucionDestruida, elegido, mejorRuta);
            }
            pendientes.remove(elegido);
        }

        IALNSSolutionSupport.normalizarSolucion(solucionDestruida);
        return solucionDestruida;
    }

    @Override
    public String getNombre() {
        return "RegretCriterionRepair";
    }
}