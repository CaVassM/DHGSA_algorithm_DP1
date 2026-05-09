package com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSContext;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSSolutionSupport;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.RepairOperator;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.Comparator;
import java.util.List;
import java.util.Random;

public class RandomKRepair implements RepairOperator {

    @Override
    public Individuo reparar(Individuo solucionDestruida,
                             List<Envio> enviosRemovidos,
                             IALNSContext ctx,
                             int iteracion,
                             Random random) {
        int k = 3 + (iteracion / 500);

        for (Envio envio : enviosRemovidos) {
            List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, envio, ctx).stream()
                    .sorted(Comparator.comparingDouble(ruta -> IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, ruta, ctx)))
                    .toList();

            if (candidatas.isEmpty()) {
                IALNSSolutionSupport.marcarNoAsignado(solucionDestruida, envio);
                continue;
            }

            int topK = Math.min(k, candidatas.size());
            RutaEnvio elegida = candidatas.get(random.nextInt(topK));
            IALNSSolutionSupport.insertarEnvio(solucionDestruida, envio, elegida);
        }

        IALNSSolutionSupport.normalizarSolucion(solucionDestruida);
        return solucionDestruida;
    }

    @Override
    public String getNombre() {
        return "RandomKRepair";
    }
}