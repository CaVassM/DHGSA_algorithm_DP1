package com.TasfB2B.DHGS.demo.algorithm.dhgs;

import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import lombok.Getter;
import lombok.Setter;

import java.util.*;

@Getter
@Setter
public class Individuo {
    // Identificacion
    private String id;
    private int epoca;

    // Representacion
    private Map<Envio, RutaEnvio> enviosAsignados;
    private List<Envio> enviosNoAsignados;
    private List<Envio> representacionGigante; // Giant Tour

    // Metricas de calidad
    private double costoDistanciaTotal;
    private double lateness; // Suma de urgencias
    private double violacionesCapacidad; // Penalizacion
    private double violacionesTiempo; // Penalizacion

    // Resultado final
    private double fitness;
    private boolean esFactible;

    public Individuo() {
        this.id = UUID.randomUUID().toString().substring(0, 8);
        this.enviosAsignados = new LinkedHashMap<>();
        this.enviosNoAsignados = new ArrayList<>();
        this.representacionGigante = new ArrayList<>();
        this.costoDistanciaTotal = 0.0;
        this.lateness = 0.0;
        this.violacionesCapacidad = 0.0;
        this.violacionesTiempo = 0.0;
        this.fitness = 0.0;
        this.esFactible = false;
    }

    /**
     * Helper LEGACY conservado por compatibilidad.
     *
     * <p>IMPORTANTE: el flujo real del algoritmo NO usa este método para evaluar
     * individuos. El fitness activo del proyecto se calcula en
     * {@code CalculadorFitness.calcular(...)} y es el que consumen:
     * población, búsqueda local, constructor de soluciones y {@code DHGSAlgorithm}.
     *
     * <p>Este método mantiene una fórmula antigua/experimental normalizada por época,
     * útil solo como referencia histórica. No representa la función objetivo vigente.
     */
    @Deprecated(since = "2026-04")
    public double calcularFitness(int epoca, int totalEpocas) {
        double costoTotal = calcularCostoTotal();
        double factorEpoca = (totalEpocas > 0)
                ? ((double) (epoca - 1) / totalEpocas) + 1.0
                : 1.0;
        int n = enviosAsignados != null ? enviosAsignados.size() : 0;

        this.fitness = (n > 0) ? costoTotal / (factorEpoca * (n + 1)) : Double.MAX_VALUE;
        return this.fitness;
    }

    /**
     * Calcula el costo real sin penalizaciones (solo distancia × maletas).
     */
    public double calcularCostoTotal() {
        if (enviosAsignados == null || enviosAsignados.isEmpty()) {
            this.costoDistanciaTotal = 0.0;
            return 0.0;
        }

        this.costoDistanciaTotal = enviosAsignados.values().stream()
                .mapToDouble(RutaEnvio::getCosto)
                .sum();

        return this.costoDistanciaTotal;
    }

    /**
     * Verifica si la solución puede ejecutarse sin violar restricciones duras.
     * Una solución es factible si:
     * - Todos los must-go están asignados
     * - Todas las rutas son factibles (conectividad + deadline)
     * - No hay violaciones de capacidad
     */
    public boolean validarFactibilidad() {
        if (enviosAsignados == null) {
            this.esFactible = false;
            return false;
        }

        // Verificar que todos los must-go estén asignados
        if (enviosNoAsignados != null) {
            boolean mustGoSinAsignar = enviosNoAsignados.stream()
                    .anyMatch(Envio::isEsMustGo);
            if (mustGoSinAsignar) {
                this.esFactible = false;
                return false;
            }
        }

        // Verificar que todas las rutas asignadas sean factibles
        boolean todasFactibles = enviosAsignados.values().stream()
                .allMatch(RutaEnvio::esFactible);

        this.esFactible = todasFactibles
                && this.violacionesCapacidad <= 0
                && this.violacionesTiempo <= 0;

        return this.esFactible;
    }

    /**
     * Retorna un diagnóstico detallado de qué restricciones se violan.
     */
    public Map<String, Double> obtenerViolaciones() {
        Map<String, Double> violaciones = new LinkedHashMap<>();

        violaciones.put("violacionesCapacidad", this.violacionesCapacidad);
        violaciones.put("violacionesTiempo", this.violacionesTiempo);
        violaciones.put("lateness", this.lateness);

        // Contar must-go no asignados
        long mustGoSinAsignar = (enviosNoAsignados != null)
                ? enviosNoAsignados.stream().filter(Envio::isEsMustGo).count()
                : 0;
        violaciones.put("mustGoNoAsignados", (double) mustGoSinAsignar);

        // Contar rutas infactibles
        long rutasInfactibles = (enviosAsignados != null)
                ? enviosAsignados.values().stream().filter(r -> !r.esFactible()).count()
                : 0;
        violaciones.put("rutasInfactibles", (double) rutasInfactibles);

        // Suma de retrasos
        double retrasoTotal = (enviosAsignados != null)
                ? enviosAsignados.values().stream().mapToDouble(RutaEnvio::getRetraso).sum()
                : 0;
        violaciones.put("retrasoTotalMinutos", retrasoTotal);

        return violaciones;
    }

    /**
     * Crea una copia profunda de este individuo.
     */
    public Individuo clonar() {
        Individuo copia = new Individuo();
        copia.setId(UUID.randomUUID().toString().substring(0, 8));
        copia.setEpoca(this.epoca);

        // Clonar envíos asignados
        if (this.enviosAsignados != null) {
            Map<Envio, RutaEnvio> copiaAsignados = new LinkedHashMap<>();
            for (Map.Entry<Envio, RutaEnvio> entry : this.enviosAsignados.entrySet()) {
                copiaAsignados.put(entry.getKey(), entry.getValue().clonar());
            }
            copia.setEnviosAsignados(copiaAsignados);
        }

        // Clonar listas
        copia.setEnviosNoAsignados(this.enviosNoAsignados != null
                ? new ArrayList<>(this.enviosNoAsignados) : new ArrayList<>());
        copia.setRepresentacionGigante(this.representacionGigante != null
                ? new ArrayList<>(this.representacionGigante) : new ArrayList<>());

        // Copiar métricas
        copia.setCostoDistanciaTotal(this.costoDistanciaTotal);
        copia.setLateness(this.lateness);
        copia.setViolacionesCapacidad(this.violacionesCapacidad);
        copia.setViolacionesTiempo(this.violacionesTiempo);
        copia.setFitness(this.fitness);
        copia.setEsFactible(this.esFactible);

        return copia;
    }

    @Override
    public String toString() {
        int asignados = enviosAsignados != null ? enviosAsignados.size() : 0;
        int noAsignados = enviosNoAsignados != null ? enviosNoAsignados.size() : 0;
        return String.format("Individuo[id=%s, epoca=%d, asignados=%d, noAsignados=%d, fitness=%.4f, factible=%s]",
                id, epoca, asignados, noAsignados, fitness, esFactible);
    }
}
