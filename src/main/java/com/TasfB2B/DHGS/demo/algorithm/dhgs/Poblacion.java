package com.TasfB2B.DHGS.demo.algorithm.dhgs;

import java.util.*;

/**
 * Gestiona el conjunto de soluciones que evolucionan.
 * Mantiene dos subpoblaciones: factibles e infactibles (max 25 cada una).
 */
public class Poblacion {

    /**
     * Tupla inmutable de dos individuos (padres seleccionados).
     */
    public record Par<A, B>(A primero, B segundo) {}

    private List<Individuo> factibles;
    private List<Individuo> infactibles;
    private Individuo mejorHistorico;
    private static final int TAMANO_MAXIMO = 25;
    private double diversidad;

    public Poblacion() {
        this.factibles = new ArrayList<>();
        this.infactibles = new ArrayList<>();
        this.mejorHistorico = null;
        this.diversidad = 0.0;
    }

    // --- Getters ---
    public List<Individuo> getFactibles() { return factibles; }
    public List<Individuo> getInfactibles() { return infactibles; }
    public Individuo getMejorHistorico() { return mejorHistorico; }
    public double getDiversidad() { return diversidad; }
    public int getTamanoTotal() { return factibles.size() + infactibles.size(); }
    public List<Individuo> getTodos() {
        List<Individuo> todos = new ArrayList<>(factibles.size() + infactibles.size());
        todos.addAll(factibles);
        todos.addAll(infactibles);
        return todos;
    }

    /**
     * Calcula el ratio de soluciones factibles sobre el total.
     */
    public double getRatioFactibles() {
        int total = getTamanoTotal();
        return total > 0 ? (double) factibles.size() / total : 0.0;
    }

    /**
     * Agrega un individuo a la subpoblación correspondiente,
     * verificando factibilidad y manteniendo el tamaño máximo.
     */
    public void agregar(Individuo individuo) {
        if (individuo == null) return;

        individuo.validarFactibilidad();

        if (individuo.isEsFactible()) {
            factibles.add(individuo);
            // Actualizar mejor histórico
            if (mejorHistorico == null || individuo.getFitness() < mejorHistorico.getFitness()) {
                mejorHistorico = individuo.clonar();
            }
            // Si excede límite, eliminar el peor
            if (factibles.size() > TAMANO_MAXIMO) {
                eliminarPeorDe(factibles);
            }
        } else {
            infactibles.add(individuo);
            if (infactibles.size() > TAMANO_MAXIMO) {
                eliminarPeorDe(infactibles);
            }
        }

        this.diversidad = calcularDiversidad();
    }

    /**
     * Selecciona dos padres usando torneo binario considerando fitness y diversidad.
     * Elige de ambas subpoblaciones mezcladas.
     */
    public Par<Individuo, Individuo> seleccionarPadres() {
        List<Individuo> todos = new ArrayList<>();
        todos.addAll(factibles);
        todos.addAll(infactibles);

        if (todos.size() < 2) {
            throw new IllegalStateException("Se necesitan al menos 2 individuos para seleccionar padres.");
        }

        Random random = new Random();
        Individuo padre1 = torneoBinario(todos, random);
        Individuo padre2 = torneoBinario(todos, random);

        // Asegurar que no sean el mismo individuo
        int intentos = 0;
        // La iteracion se mantiene hasta que cambie el individuo.
        // Aqui la csoa es, por que 10?
        while (padre2.getId().equals(padre1.getId()) && intentos < 10) {
            padre2 = torneoBinario(todos, random);
            intentos++;
        }

        return new Par<>(padre1, padre2);
    }

    /**
     * Elimina los peores individuos para mantener el tamaño máximo en ambas subpoblaciones.
     */
    public void eliminarPeores() {
        while (factibles.size() > TAMANO_MAXIMO) {
            eliminarPeorDe(factibles);
        }
        while (infactibles.size() > TAMANO_MAXIMO) {
            eliminarPeorDe(infactibles);
        }
    }

    /**
     * Calcula la diversidad de la población.
     * Basada en la desviación estándar del fitness.
     * Alta diversidad = soluciones muy variadas.
     * Baja diversidad = convergencia (posible estancamiento).
     */
    public double calcularDiversidad() {
        List<Double> fitnesses = new ArrayList<>();
        factibles.forEach(i -> fitnesses.add(i.getFitness()));
        infactibles.forEach(i -> fitnesses.add(i.getFitness()));

        if (fitnesses.size() < 2) return 0.0;

        double media = fitnesses.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        double varianza = fitnesses.stream()
                .mapToDouble(f -> Math.pow(f - media, 2))
                .sum() / fitnesses.size();

        this.diversidad = Math.sqrt(varianza);
        return this.diversidad;
    }

    /**
     * Verifica si la población está estancada (diversidad muy baja).
     */
    public boolean estaEstancada(double umbralDiversidad) {
        return Double.isFinite(diversidad)
                && diversidad < umbralDiversidad
                && getTamanoTotal() > 5;
    }

    // --- Métodos privados ---

    /**
     * Torneo binario: elige 2 al azar y retorna el de mejor fitness.
     */
    private Individuo torneoBinario(List<Individuo> candidatos, Random random) {
        // El get es como l array. random.nextInt indica hasta que cantidad puede. No seria -1? bueno dejarlo asi ig.
        Individuo c1 = candidatos.get(random.nextInt(candidatos.size()));
        Individuo c2 = candidatos.get(random.nextInt(candidatos.size()));
        return c1.getFitness() <= c2.getFitness() ? c1 : c2;
    }

    /**
     * Elimina el individuo con peor fitness de una lista.
     */
    private void eliminarPeorDe(List<Individuo> lista) {
        if (lista.isEmpty()) return;
        Individuo peor = lista.stream()
                .max(Comparator.comparingDouble(Individuo::getFitness))
                .orElse(null);
        if (peor != null) {
            lista.remove(peor);
        }
    }

    @Override
    public String toString() {
        return String.format("Poblacion[factibles=%d, infactibles=%d, diversidad=%.4f, mejor=%s]",
                factibles.size(), infactibles.size(), diversidad,
                mejorHistorico != null ? mejorHistorico.getFitness() : "N/A");
    }
}
