package com.TasfB2B.DHGS.demo.algorithm.ialns.operators;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSContext;
import com.TasfB2B.DHGS.demo.domain.model.Envio;

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