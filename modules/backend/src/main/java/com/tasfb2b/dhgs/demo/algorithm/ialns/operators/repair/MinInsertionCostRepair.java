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

public class MinInsertionCostRepair implements RepairOperator {

    @Override
    public Individuo reparar(Individuo solucionDestruida,
                             List<Envio> enviosRemovidos,
                             IALNSContext ctx,
                             int iteracion,
                             Random random) {
        List<Envio> pendientes = new ArrayList<>(enviosRemovidos);
        while (!pendientes.isEmpty()) {
            Envio masDificil = null;
            double mayorZi = Double.NEGATIVE_INFINITY;

            for (Envio envio : pendientes) {
                List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, envio, ctx);
                double zi = candidatas.isEmpty()
                        ? IALNSSolutionSupport.penalizacionNoAsignado(envio)
                        : candidatas.stream()
                                .mapToDouble(ruta -> IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envio, ruta, ctx) - solucionDestruida.getFitness())
                                .min()
                                .orElse(IALNSSolutionSupport.penalizacionNoAsignado(envio));
                if (zi > mayorZi) {
                    mayorZi = zi;
                    masDificil = envio;
                }
            }

            if (masDificil == null) {
                break;
            }

            List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, masDificil, ctx);
                Envio envioSeleccionado = masDificil;
            RutaEnvio mejor = candidatas.stream()
                    .min(Comparator.comparingDouble(ruta -> IALNSSolutionSupport.evaluarInsercion(solucionDestruida, envioSeleccionado, ruta, ctx)))
                    .orElse(null);

            if (mejor == null) {
                IALNSSolutionSupport.marcarNoAsignado(solucionDestruida, masDificil);
            } else {
                IALNSSolutionSupport.insertarEnvio(solucionDestruida, masDificil, mejor);
            }
            pendientes.remove(masDificil);
        }

        IALNSSolutionSupport.normalizarSolucion(solucionDestruida);
        return solucionDestruida;
    }

    @Override
    public String getNombre() {
        return "MinInsertionCostRepair";
    }
}