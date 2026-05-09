package com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSSolutionSupport;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.DestroyOperator;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;

public class MaxWaitingTimeDestroy implements DestroyOperator {

    @Override
    public ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random) {
        Map<String, List<Map.Entry<Envio, RutaEnvio>>> grupos = IALNSSolutionSupport.agruparPorRuta(solucion);
        if (grupos.isEmpty()) {
            return new ResultadoDestruccion(solucion.clonar(), new ArrayList<>());
        }

        List<Map.Entry<Envio, RutaEnvio>> peorGrupo = grupos.values().stream()
                .max(Comparator.comparingDouble(IALNSSolutionSupport::tiempoPenalizadoGrupo))
                .orElse(List.of());

        return removerEnvios(solucion, peorGrupo.stream().map(Map.Entry::getKey).toList());
    }

    @Override
    public String getNombre() {
        return "MaxWaitingTimeDestroy";
    }
}