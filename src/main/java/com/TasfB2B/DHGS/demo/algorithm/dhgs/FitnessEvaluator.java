package com.TasfB2B.DHGS.demo.algorithm.dhgs;

import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.valueobject.ParametrosPenalizacion;

/**
 * Evaluador de fitness para soluciones DHGS.
 *
 * Fórmula:
 * fitness = (pDist * Sdist + pCap * Scap + pTime * Stime + pLate * Slate)
 *           / (factorEpoca * (n + 1))
 *
 * donde:
 * - Sdist = suma distancias de rutas
 * - Scap = penalización por exceso capacidad
 * - Stime = penalización por violar deadlines
 * - Slate = suma de end-times (urgencias)
 * - n = número de envíos asignados
 * - factorEpoca = ((epoca-1)/totalEpocas + 1)
 */
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
     * Evalúa el fitness de un individuo considerando penalizaciones y normalización por época.
     *
     * TODO: La fórmula exacta debe refinarse con el paper DHGS.
     * Por ahora implementa la estructura base.
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
        double costoTotal = (1.0 * sDist)
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
