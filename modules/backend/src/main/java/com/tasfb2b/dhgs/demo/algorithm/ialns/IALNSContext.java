package com.tasfb2b.dhgs.demo.algorithm.ialns;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;

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