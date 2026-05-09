package com.tasfb2b.dhgs.demo.domain.valueobject;

import lombok.Getter;
import lombok.Setter;

/**
 * Parámetros de penalización adaptativos para el algoritmo DHGS.
 * Se ajustan dinámicamente según el ratio de soluciones factibles/infactibles.
 *
 * <p>En el flujo ACTIVO del proyecto estos parámetros alimentan a
 * {@code CalculadorFitness}, que usa principalmente:
 *
 * <pre>
 * fitness = costoDistancia
 *         + penCapacidad * violacionesCapacidad
 *         + penTiempo * violacionesTiempo
 *         + penalizacionNoAsignados
 * </pre>
 *
 * <p>`penLateness` se mantiene por compatibilidad con fórmulas legacy/experimentales,
 * pero no participa en la evaluación operativa actual.
 */
@Getter
@Setter
public class ParametrosPenalizacion {

    private double penCapacidad;       // Penalización por violación de capacidad (vuelos/almacenes)
    private double penTiempo;          // Penalización por violación de deadlines
    private double penLateness;        // Reservado para fórmulas legacy/experimentales
    private double factorNormalizacion; // Factor de normalización

    // Constantes de ajuste
    private static final double FACTOR_INCREMENTO = 1.2;
    private static final double FACTOR_DECREMENTO = 0.85;
    private static final double PEN_MINIMA = 0.1;
    private static final double PEN_MAXIMA = 10000.0;

    public ParametrosPenalizacion() {
        this.penCapacidad = 1000.0;  // Peso para Σ(exceso_capacidad²)
        this.penTiempo = 5000.0;     // Peso para Σ(retraso²)
        this.penLateness = 100.0;
        this.factorNormalizacion = 1.0;
    }

    public ParametrosPenalizacion(double penCapacidad, double penTiempo, double penLateness) {
        this.penCapacidad = penCapacidad;
        this.penTiempo = penTiempo;
        this.penLateness = penLateness;
        this.factorNormalizacion = 1.0;
    }

    /**
     * Ajusta las penalizaciones según el ratio de soluciones factibles en la población.
     * - Si hay muchas infactibles (ratio bajo): se reducen penalizaciones para explorar más
     * - Si hay muchas factibles (ratio alto): se aumentan penalizaciones para intensificar
     *
     * @param ratioFactibles porcentaje de soluciones factibles (0.0 a 1.0)
     */
    public void ajustar(double ratioFactibles) {
        if (ratioFactibles < 0.2) {
            // Muchas infactibles → aumentar penalizaciones para forzar factibilidad
            this.penCapacidad = Math.min(PEN_MAXIMA, this.penCapacidad * FACTOR_INCREMENTO);
            this.penTiempo = Math.min(PEN_MAXIMA, this.penTiempo * FACTOR_INCREMENTO);
        } else if (ratioFactibles > 0.8) {
            // Muchas factibles → reducir penalizaciones para explorar infactibles prometedores
            this.penCapacidad = Math.max(PEN_MINIMA, this.penCapacidad * FACTOR_DECREMENTO);
            this.penTiempo = Math.max(PEN_MINIMA, this.penTiempo * FACTOR_DECREMENTO);
        }
        // Entre 0.2 y 0.8: equilibrio, no se ajusta
    }

    /**
     * Calcula el factor de normalización por época.
     * Progresión lineal: al avanzar las épocas se penaliza más no despachar.
     */
    public double calcularFactorEpoca(int epocaActual, int totalEpocas) {
        if (totalEpocas <= 0) {
            return 1.0;
        }
        return ((double) (epocaActual - 1) / totalEpocas) + 1.0;
    }

    /**
     * Restaura las penalizaciones a sus valores iniciales.
     */
    public void reset() {
        this.penCapacidad = 1000.0;
        this.penTiempo = 5000.0;
        this.penLateness = 100.0;
        this.factorNormalizacion = 1.0;
    }

    @Override
    public String toString() {
        return String.format("Params[cap=%.2f, time=%.2f, late=%.2f, norm=%.2f]",
                penCapacidad, penTiempo, penLateness, factorNormalizacion);
    }
}

