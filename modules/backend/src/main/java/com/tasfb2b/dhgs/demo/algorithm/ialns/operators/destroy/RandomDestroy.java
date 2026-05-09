package com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSSolutionSupport;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.DestroyOperator;
import com.tasfb2b.dhgs.demo.domain.model.Envio;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Random;

public class RandomDestroy implements DestroyOperator {

    private double factorQ = 0.10;

    public void setFactorQ(double factorQ) {
        this.factorQ = factorQ;
    }

    @Override
    public ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random) {
        List<Envio> asignados = IALNSSolutionSupport.obtenerEnviosAsignados(solucion);
        if (asignados.isEmpty()) {
            return new ResultadoDestruccion(solucion.clonar(), new ArrayList<>());
        }

        int q = Math.max(1, (int) Math.ceil(asignados.size() * factorQ));
        List<Envio> candidatos = new ArrayList<>(asignados);
        Collections.shuffle(candidatos, random);
        return removerEnvios(solucion, candidatos.subList(0, Math.min(q, candidatos.size())));
    }

    @Override
    public String getNombre() {
        return "RandomDestroy";
    }
}