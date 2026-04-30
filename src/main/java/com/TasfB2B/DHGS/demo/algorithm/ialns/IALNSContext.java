package com.TasfB2B.DHGS.demo.algorithm.ialns;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.infraestructure.util.AlgoritmoSPLIT;
import com.TasfB2B.DHGS.demo.infraestructure.util.CalculadorFitness;
import com.TasfB2B.DHGS.demo.infraestructure.util.Validador;

public record IALNSContext(
        AlgoritmoSPLIT split,
        CalculadorFitness calculadorFitness,
        Validador validador,
        int epocaActual,
        int totalEpocas) {

    public RutaEnvio asignarMejorRuta(Envio envio) {
        return split.asignarMejorRuta(envio);
    }

    public void evaluar(Individuo individuo) {
        IALNSSolutionSupport.normalizarSolucion(individuo);
        calculadorFitness.calcularViolaciones(individuo);
        calculadorFitness.calcular(individuo, epocaActual, totalEpocas);
        individuo.setEsFactible(validador.esFactible(individuo));
    }
}