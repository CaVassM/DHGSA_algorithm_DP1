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

public class GlobalOptimalRepair implements RepairOperator {

    @Override
    public Individuo reparar(Individuo solucionDestruida,
                             List<Envio> enviosRemovidos,
                             IALNSContext ctx,
                             int iteracion,
                             Random random) {
        for (Envio envio : enviosRemovidos) {
            List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, envio, ctx);
            RutaEnvio mejor = candidatas.stream()
                    .min(Comparator.comparingDouble(ruta -> IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, ruta, ctx)))
                    .orElse(null);

            if (mejor == null) {
                IALNSSolutionSupport.marcarNoAsignado(solucionDestruida, envio);
            } else {
                IALNSSolutionSupport.insertarEnvio(solucionDestruida, envio, mejor);
            }
        }

        IALNSSolutionSupport.normalizarSolucion(solucionDestruida);
        return solucionDestruida;
    }

    @Override
    public String getNombre() {
        return "GlobalOptimalRepair";
    }
}