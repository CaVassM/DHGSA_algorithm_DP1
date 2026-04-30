package com.TasfB2B.DHGS.demo.algorithm.ialns.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public interface DestroyOperator {

    record ResultadoDestruccion(Individuo solucionDestruida, List<Envio> enviosRemovidos) {
    }

    ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random);

    String getNombre();

    default ResultadoDestruccion removerEnvios(Individuo solucion, List<Envio> enviosARemover) {
        Individuo clon = solucion.clonar();
        List<Envio> removidos = new ArrayList<>();
        for (Envio envio : enviosARemover) {
            if (clon.getEnviosAsignados().remove(envio) != null) {
                removidos.add(envio);
                if (!clon.getEnviosNoAsignados().contains(envio)) {
                    clon.getEnviosNoAsignados().add(envio);
                }
            }
        }
        return new ResultadoDestruccion(clon, removidos);
    }
}