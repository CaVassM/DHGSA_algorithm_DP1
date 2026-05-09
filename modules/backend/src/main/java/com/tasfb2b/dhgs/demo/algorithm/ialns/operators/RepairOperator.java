package com.tasfb2b.dhgs.demo.algorithm.ialns.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSContext;
import com.tasfb2b.dhgs.demo.domain.model.Envio;

import java.util.List;
import java.util.Random;

public interface RepairOperator {

    Individuo reparar(Individuo solucionDestruida,
                      List<Envio> enviosRemovidos,
                      IALNSContext ctx,
                      int iteracion,
                      Random random);

    String getNombre();
}