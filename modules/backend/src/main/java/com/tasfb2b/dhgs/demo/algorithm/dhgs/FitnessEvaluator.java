package com.tasfb2b.dhgs.demo.algorithm.dhgs;

import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.valueobject.ParametrosPenalizacion;

/**
 * Evaluador LEGACY/experimental de fitness para soluciones DHGS.
 *
 * <p>Esta clase NO está conectada al flujo real de ejecución. El algoritmo actual
 * usa {@code CalculadorFitness} como fuente de verdad para evaluar individuos.
 * Se conserva únicamente como referencia histórica de una fórmula normalizada por
 * época que se exploró durante el desarrollo.
 */
@Deprecated(since = "2026-04")
public class FitnessEvaluator {

    private ParametrosPenalizacion parametros;

    public FitnessEvaluator() {
        this.parametros = new ParametrosPenalizacion();
    }

    public FitnessEvaluator(ParametrosPenalizacion parametros) {
        this.parametros = parametros;
    }

    public ParametrosPenalizacion getParametros() {
        return parametros;
    }

    public void setParametros(ParametrosPenalizacion parametros) {
        this.parametros = parametros;
    }

    /**
     * Evalúa un fitness legacy normalizado por época.
     *
     * <p>No debe usarse para comparar resultados del algoritmo actual ni para
     * interpretar los tests/documentación operativa del proyecto.
     */
    public double evaluar(Individuo individuo, int epocaActual, int totalEpocas) {
        if (individuo == null || individuo.getEnviosAsignados() == null) {
            return Double.MAX_VALUE;
        }

        // Calcular componentes
        double sDist = calcularSumaDistancias(individuo);
        double sCap = individuo.getViolacionesCapacidad();
        double sTime = individuo.getViolacionesTiempo();
        double sLate = individuo.getLateness();

        // Aplicar pesos de penalización
        double costoTotal = sDist
                + (parametros.getPenCapacidad() * sCap)
                + (parametros.getPenTiempo() * sTime)
                + (parametros.getPenLateness() * sLate);

        // Normalizar por época y número de envíos
        double factorEpoca = parametros.calcularFactorEpoca(epocaActual, totalEpocas);
        int n = individuo.getEnviosAsignados().size();

        double fitness = (n > 0)
                ? costoTotal / (factorEpoca * (n + 1))
                : Double.MAX_VALUE;

        individuo.setFitness(fitness);
        return fitness;
    }

    /**
     * Calcula la suma de distancias de todas las rutas asignadas.
     */
    private double calcularSumaDistancias(Individuo individuo) {
        return individuo.getEnviosAsignados().values().stream()
                .mapToDouble(RutaEnvio::getDistanciaTotal)
                .sum();
    }
}
