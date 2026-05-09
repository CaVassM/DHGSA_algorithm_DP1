package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Contexto compartido entre operadores de búsqueda local.
 * Provee acceso a SPLIT y CalculadorFitness para evaluación incremental.
 */
public class LocalSearchContext {

    private final AlgoritmoSPLIT split;
    private final CalculadorFitness fitness;
    private final int epocaActual;
    private final int totalEpocas;
    private final List<Envio> universoEnvios;

    public LocalSearchContext(AlgoritmoSPLIT split, CalculadorFitness fitness,
                              int epocaActual, int totalEpocas,
                              List<Envio> universoEnvios) {
        this.split = split;
        this.fitness = fitness;
        this.epocaActual = epocaActual;
        this.totalEpocas = totalEpocas;
        this.universoEnvios = universoEnvios != null ? new ArrayList<>(universoEnvios) : List.of();
    }

    public AlgoritmoSPLIT getSplit() { return split; }
    public CalculadorFitness getFitness() { return fitness; }
    public int getEpocaActual() { return epocaActual; }
    public int getTotalEpocas() { return totalEpocas; }
    public List<Envio> getUniversoEnvios() { return universoEnvios; }

    public List<Envio> construirNoAsignados(Map<Envio, RutaEnvio> asignaciones) {
        List<Envio> noAsignados = new ArrayList<>();
        for (Envio envio : universoEnvios) {
            if (asignaciones == null || !asignaciones.containsKey(envio)) {
                noAsignados.add(envio);
            }
        }
        return noAsignados;
    }

    public List<Envio> agregarAlTour(List<Envio> tourActual, Envio envio) {
        List<Envio> tour = normalizarTour(tourActual);
        if (envio != null && !tour.contains(envio)) {
            tour.add(envio);
        }
        return tour;
    }

    public List<Envio> removerDelTour(List<Envio> tourActual, Envio envio) {
        List<Envio> tour = normalizarTour(tourActual);
        if (envio != null) {
            tour.removeIf(envio::equals);
        }
        return tour;
    }

    public List<Envio> reemplazarEnTour(List<Envio> tourActual, Envio envioSalida, Envio envioEntrada) {
        List<Envio> tour = normalizarTour(tourActual);
        int indice = envioSalida != null ? tour.indexOf(envioSalida) : -1;

        if (envioSalida != null) {
            tour.removeIf(envioSalida::equals);
        }
        if (envioEntrada != null) {
            tour.removeIf(envioEntrada::equals);
            if (indice >= 0 && indice <= tour.size()) {
                tour.add(indice, envioEntrada);
            } else {
                tour.add(envioEntrada);
            }
        }

        return tour;
    }

    private List<Envio> normalizarTour(List<Envio> tourActual) {
        if (tourActual == null || tourActual.isEmpty()) {
            return new ArrayList<>();
        }

        Set<Envio> vistos = new LinkedHashSet<>();
        List<Envio> normalizado = new ArrayList<>();
        for (Envio envio : tourActual) {
            if (envio != null && vistos.add(envio)) {
                normalizado.add(envio);
            }
        }
        return normalizado;
    }

    /** Evalúa violaciones + fitness de un individuo de una sola vez. */
    public double evaluar(com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo ind) {
        fitness.calcularViolaciones(ind);
        double valor = fitness.calcular(ind, epocaActual, totalEpocas);
        ind.validarFactibilidad();
        return valor;
    }
}

