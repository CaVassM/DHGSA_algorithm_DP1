package com.tasfb2b.dhgs.demo.algorithm.ialns;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;

import java.util.Arrays;
import java.util.Random;

public class IALNSState {

    static final double T_INICIAL = 500.0;
    static final double T_FINAL = 0.01;
    static final double COOLING = 0.98;

    private final double[] pesosDestruccion;
    private final double[] pesosReparacion;
    private final double[] scoresDestruccion;
    private final double[] scoresReparacion;
    private final int[] usosDestruccion;
    private final int[] usosReparacion;

    private double temperatura;
    private int iteracion;
    private double factorQ;
    private Individuo mejorGlobal;
    private Individuo actual;

    public IALNSState(int operadoresDestruccion, int operadoresReparacion) {
        this.pesosDestruccion = new double[operadoresDestruccion];
        this.pesosReparacion = new double[operadoresReparacion];
        this.scoresDestruccion = new double[operadoresDestruccion];
        this.scoresReparacion = new double[operadoresReparacion];
        this.usosDestruccion = new int[operadoresDestruccion];
        this.usosReparacion = new int[operadoresReparacion];
    }

    public void reset(Individuo solucionInicial) {
        Arrays.fill(pesosDestruccion, 1.0);
        Arrays.fill(pesosReparacion, 1.0);
        Arrays.fill(scoresDestruccion, 0.0);
        Arrays.fill(scoresReparacion, 0.0);
        Arrays.fill(usosDestruccion, 0);
        Arrays.fill(usosReparacion, 0);
        this.temperatura = T_INICIAL;
        this.iteracion = 0;
        this.factorQ = 0.10;
        this.actual = solucionInicial.clonar();
        this.mejorGlobal = solucionInicial.clonar();
    }

    public int seleccionarDestruccion(Random random) {
        return seleccionarOperador(pesosDestruccion, random);
    }

    public int seleccionarReparacion(Random random) {
        return seleccionarOperador(pesosReparacion, random);
    }

    private int seleccionarOperador(double[] pesos, Random random) {
        double total = Arrays.stream(pesos).sum();
        if (total <= 0) {
            return random.nextInt(pesos.length);
        }
        double umbral = random.nextDouble() * total;
        double acumulado = 0.0;
        for (int indice = 0; indice < pesos.length; indice++) {
            acumulado += pesos[indice];
            if (umbral <= acumulado) {
                return indice;
            }
        }
        return pesos.length - 1;
    }

    public void actualizarScoreDestruccion(int indice, Individuo nueva) {
        actualizarScore(scoresDestruccion, usosDestruccion, indice, nueva);
    }

    public void actualizarScoreReparacion(int indice, Individuo nueva) {
        actualizarScore(scoresReparacion, usosReparacion, indice, nueva);
    }

    private void actualizarScore(double[] scores, int[] usos, int indice, Individuo nueva) {
        usos[indice]++;
        if (esMejor(nueva, mejorGlobal)) {
            scores[indice] += 6.0;
        } else if (nueva.getFitness() < actual.getFitness()) {
            scores[indice] += 3.0;
        } else if (Double.compare(nueva.getFitness(), actual.getFitness()) == 0) {
            scores[indice] += 1.0;
        }
    }

    public void actualizarPesos(double alpha) {
        actualizarPesos(pesosDestruccion, scoresDestruccion, usosDestruccion, alpha);
        actualizarPesos(pesosReparacion, scoresReparacion, usosReparacion, alpha);
        Arrays.fill(scoresDestruccion, 0.0);
        Arrays.fill(scoresReparacion, 0.0);
        Arrays.fill(usosDestruccion, 0);
        Arrays.fill(usosReparacion, 0);
    }

    private void actualizarPesos(double[] pesos, double[] scores, int[] usos, double alpha) {
        for (int indice = 0; indice < pesos.length; indice++) {
            if (usos[indice] <= 0) {
                continue;
            }
            double historico = pesos[indice];
            double reciente = scores[indice] / usos[indice];
            pesos[indice] = Math.max(0.01, (alpha * historico) + ((1.0 - alpha) * reciente));
        }
    }

    public boolean aceptar(Individuo nueva, Random random) {
        if (nueva.getFitness() < actual.getFitness()) {
            return true;
        }
        if (temperatura <= T_FINAL) {
            return false;
        }
        double delta = nueva.getFitness() - actual.getFitness();
        return random.nextDouble() < Math.exp(-delta / temperatura);
    }

    public void enfriar() {
        temperatura *= COOLING;
    }

    public boolean temperaturaActiva() {
        return temperatura > T_FINAL;
    }

    public boolean esMejor(Individuo candidata, Individuo referencia) {
        if (candidata == null) {
            return false;
        }
        if (referencia == null) {
            return true;
        }
        if (candidata.isEsFactible() != referencia.isEsFactible()) {
            return candidata.isEsFactible();
        }
        return candidata.getFitness() < referencia.getFitness();
    }

    public double getTemperatura() {
        return temperatura;
    }

    public int getIteracion() {
        return iteracion;
    }

    public void setIteracion(int iteracion) {
        this.iteracion = iteracion;
    }

    public double getFactorQ() {
        return factorQ;
    }

    public void setFactorQ(double factorQ) {
        this.factorQ = factorQ;
    }

    public Individuo getMejorGlobal() {
        return mejorGlobal;
    }

    public void setMejorGlobal(Individuo mejorGlobal) {
        this.mejorGlobal = mejorGlobal;
    }

    public Individuo getActual() {
        return actual;
    }

    public void setActual(Individuo actual) {
        this.actual = actual;
    }
}