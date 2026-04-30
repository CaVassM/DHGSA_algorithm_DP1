package com.TasfB2B.DHGS.demo.algorithm.ialns.operators.destroy;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSSolutionSupport;
import com.TasfB2B.DHGS.demo.algorithm.ialns.operators.DestroyOperator;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;

public class DestroyingVehicleDestroy implements DestroyOperator {

    @Override
    public ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random) {
        Map<String, List<Map.Entry<Envio, RutaEnvio>>> grupos = IALNSSolutionSupport.agruparPorRuta(solucion);
        if (grupos.isEmpty()) {
            return new ResultadoDestruccion(solucion.clonar(), new ArrayList<>());
        }

        List<Map.Entry<Envio, RutaEnvio>> peorGrupo = grupos.values().stream()
                .max(Comparator.comparingDouble(IALNSSolutionSupport::costoCompuestoGrupo))
                .orElse(List.of());

        return removerEnvios(solucion, peorGrupo.stream().map(Map.Entry::getKey).toList());
    }

    @Override
    public String getNombre() {
        return "DestroyingVehicleDestroy";
    }
}