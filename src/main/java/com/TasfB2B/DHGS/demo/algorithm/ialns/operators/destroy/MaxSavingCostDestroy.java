package com.TasfB2B.DHGS.demo.algorithm.ialns.operators.destroy;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSSolutionSupport;
import com.TasfB2B.DHGS.demo.algorithm.ialns.operators.DestroyOperator;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

public class MaxSavingCostDestroy implements DestroyOperator {

    @Override
    public ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random) {
        Map<String, List<Map.Entry<Envio, RutaEnvio>>> grupos = IALNSSolutionSupport.agruparPorRuta(solucion);
        if (grupos.isEmpty()) {
            return new ResultadoDestruccion(solucion.clonar(), new ArrayList<>());
        }

        List<Envio> asignados = IALNSSolutionSupport.obtenerEnviosAsignados(solucion);
        int q = Math.max(1, (int) Math.ceil(asignados.size() * 0.10));

        Map<Envio, Double> ahorros = new HashMap<>();
        for (List<Map.Entry<Envio, RutaEnvio>> grupo : grupos.values()) {
            List<Envio> ordenados = grupo.stream()
                    .map(Map.Entry::getKey)
                    .sorted(Comparator.comparing(Envio::getFechaHoraCreacion,
                            Comparator.nullsLast(Comparator.naturalOrder()))
                            .thenComparing(Envio::getId, Comparator.nullsLast(Comparator.naturalOrder())))
                    .toList();
            for (int indice = 0; indice < ordenados.size(); indice++) {
                ahorros.put(ordenados.get(indice), IALNSSolutionSupport.calcularAhorroPorRemocion(indice, ordenados));
            }
        }

        List<Envio> aRemover = ahorros.entrySet().stream()
                .sorted(Map.Entry.<Envio, Double>comparingByValue().reversed())
                .limit(q)
                .map(Map.Entry::getKey)
                .toList();

        return removerEnvios(solucion, aRemover);
    }

    @Override
    public String getNombre() {
        return "MaxSavingCostDestroy";
    }
}