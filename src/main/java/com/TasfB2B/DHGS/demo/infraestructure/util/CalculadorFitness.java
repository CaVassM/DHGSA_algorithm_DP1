package com.TasfB2B.DHGS.demo.infraestructure.util;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.model.Vuelo;
import com.TasfB2B.DHGS.demo.domain.valueobject.ParametrosPenalizacion;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * Calcula el fitness de un individuo usando penalizaciones cuadráticas.
 *
 * fitness = distanciaTotal
 *         + penCapacidad × Σ max(0, maletasAsignadas − capacidadVuelo)²
 *         + penTiempo    × Σ max(0, tiempoLlegada − deadline)²
 *
 * donde:
 * - distanciaTotal = Σ (distancia de cada ruta × maletas del envío)
 * - penalizaciones cuadráticas castigan violaciones grandes exponencialmente
 */
@Component
public class CalculadorFitness {

    private ParametrosPenalizacion parametros;

    public CalculadorFitness() {
        this.parametros = new ParametrosPenalizacion();
    }

    public CalculadorFitness(ParametrosPenalizacion parametros) {
        this.parametros = parametros;
    }

    public ParametrosPenalizacion getParametros() { return parametros; }
    public void setParametros(ParametrosPenalizacion parametros) { this.parametros = parametros; }

    /**
     * Calcula el fitness de un individuo.
     *
     * @param individuo    individuo a evaluar
     * @param epocaActual  número de la época actual
     * @param totalEpocas  total de épocas en la simulación
     * @return valor de fitness (menor = mejor)
     */
    public double calcular(Individuo individuo, int epocaActual, int totalEpocas) {
        if (individuo == null || individuo.getEnviosAsignados() == null ||
            individuo.getEnviosAsignados().isEmpty()) {
            individuo.setFitness(Double.MAX_VALUE);
            return Double.MAX_VALUE;
        }

        // Componente de distancia: Σ(distancia × maletas) por ruta
        double distanciaTotal = 0.0;
        for (Map.Entry<Envio, RutaEnvio> entry : individuo.getEnviosAsignados().entrySet()) {
            distanciaTotal += entry.getValue().getCosto(); // getCosto() = distancia × maletas
        }

        // Componentes de penalización (ya calculadas en calcularViolaciones)
        double penCap  = individuo.getViolacionesCapacidad();
        double penTime = individuo.getViolacionesTiempo();

        // Penalización por envíos no asignados: castigo proporcional a distancia × maletas
        // para que siempre sea peor NO asignar que asignar (incluso rutas lejanas)
        double penNoAsignados = 0.0;
        if (individuo.getEnviosNoAsignados() != null) {
            for (Envio noAsig : individuo.getEnviosNoAsignados()) {
                double costoEstimado = 0.0;
                if (noAsig.getAeropuertoOrigen() != null && noAsig.getAeropuertoDestino() != null) {
                    costoEstimado = noAsig.getAeropuertoOrigen().getDistanciaA(noAsig.getAeropuertoDestino())
                                  * Math.max(1, noAsig.getCantidadMaletas());
                }
                double factorMustGo = noAsig.isEsMustGo() ? 10.0 : 2.0;
                penNoAsignados += Math.max(10000.0, costoEstimado * factorMustGo);
            }
        }

        // fitness = distTotal + penCap*Σ(exceso²) + penTime*Σ(retraso²) + penNoAsignados
        double fitness = distanciaTotal
                + (parametros.getPenCapacidad() * penCap)
                + (parametros.getPenTiempo() * penTime)
                + penNoAsignados;

        individuo.setFitness(fitness);
        individuo.setCostoDistanciaTotal(distanciaTotal);
        return fitness;
    }

    /**
     * Calcula las violaciones de un individuo con penalizaciones cuadráticas.
     *
     * - Capacidad: acumula maletas por vuelo, penaliza exceso al cuadrado
     * - Tiempo: penaliza retraso sobre deadline al cuadrado
     */
    public void calcularViolaciones(Individuo individuo) {
        if (individuo == null || individuo.getEnviosAsignados() == null) return;

        // --- Violaciones de TIEMPO (cuadrática) ---
        double violTiempo = 0.0;
        double lateness = 0.0;
        for (RutaEnvio ruta : individuo.getEnviosAsignados().values()) {
            long retraso = ruta.getRetraso(); // minutos de retraso
            if (retraso > 0) {
                violTiempo += (double) retraso * retraso; // cuadrática
                lateness += retraso;
            }
        }

        // --- Violaciones de CAPACIDAD (cuadrática) ---
        // Acumular maletas por vuelo de TODOS los envíos de este individuo
        double violCapacidad = 0.0;
        Map<Vuelo, Integer> cargaPorVuelo = new HashMap<>();
        for (Map.Entry<Envio, RutaEnvio> entry : individuo.getEnviosAsignados().entrySet()) {
            Envio envio = entry.getKey();
            RutaEnvio ruta = entry.getValue();
            if (ruta.getSecuenciaVuelos() != null) {
                for (Vuelo v : ruta.getSecuenciaVuelos()) {
                    cargaPorVuelo.merge(v, envio.getCantidadMaletas(), Integer::sum);
                }
            }
        }
        for (Map.Entry<Vuelo, Integer> entry : cargaPorVuelo.entrySet()) {
            int exceso = entry.getValue() - entry.getKey().getCapacidad();
            if (exceso > 0) {
                violCapacidad += (double) exceso * exceso; // cuadrática
            }
        }

        individuo.setViolacionesCapacidad(violCapacidad);
        individuo.setViolacionesTiempo(violTiempo);
        individuo.setLateness(lateness);
    }
}
