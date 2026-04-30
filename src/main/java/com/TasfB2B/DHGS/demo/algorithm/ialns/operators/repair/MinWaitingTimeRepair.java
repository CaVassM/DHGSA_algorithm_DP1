package com.TasfB2B.DHGS.demo.algorithm.ialns.operators.repair;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSContext;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSSolutionSupport;
import com.TasfB2B.DHGS.demo.algorithm.ialns.operators.RepairOperator;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.Comparator;
import java.util.List;
import java.util.Random;

public class MinWaitingTimeRepair implements RepairOperator {

    private static final double MAX_ESPERA_MIN = 5.0;

    @Override
    public Individuo reparar(Individuo solucionDestruida,
                             List<Envio> enviosRemovidos,
                             IALNSContext ctx,
                             int iteracion,
                             Random random) {
        for (Envio envio : enviosRemovidos) {
            List<RutaEnvio> candidatas = IALNSSolutionSupport.construirRutasCandidatas(solucionDestruida, envio, ctx).stream()
                    .sorted(Comparator.comparingDouble(IALNSSolutionSupport::calcularTiempoEsperaPromedio))
                    .toList();

            if (candidatas.isEmpty()) {
                IALNSSolutionSupport.marcarNoAsignado(solucionDestruida, envio);
                continue;
            }

            RutaEnvio mejor = candidatas.getFirst();
            RutaEnvio candidata = candidatas.stream()
                    .filter(ruta -> IALNSSolutionSupport.calcularTiempoEsperaPromedio(ruta) <= MAX_ESPERA_MIN)
                    .findFirst()
                    .orElse(mejor);
            IALNSSolutionSupport.insertarEnvio(solucionDestruida, envio, candidata);
        }

        IALNSSolutionSupport.normalizarSolucion(solucionDestruida);
        return solucionDestruida;
    }

    @Override
    public String getNombre() {
        return "MinWaitingTimeRepair";
    }
}