package com.tasfb2b.dhgs.demo.algorithm.ialns;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.DestroyOperator;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.RepairOperator;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy.DestroyingVehicleDestroy;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy.MaxSavingCostDestroy;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy.MaxWaitingTimeDestroy;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy.RandomDestroy;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.destroy.SimilarityDestroy;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair.GlobalOptimalRepair;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair.MinInsertionCostRepair;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair.MinWaitingTimeRepair;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair.RandomKRepair;
import com.tasfb2b.dhgs.demo.algorithm.ialns.operators.repair.RegretCriterionRepair;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Random;

public class IALNSAlgorithm {

    private static final Logger log = LoggerFactory.getLogger(IALNSAlgorithm.class);

    private static final double ALPHA = 0.5;
    private static final int UPDATE_INTERVAL = 1000;
    private static final int UMBRAL_SIN_MEJORA = 10;
    private static final int UMBRAL_CON_MEJORA = 5;
    private static final double FACTOR_Q_ALTO = 0.15;
    private static final double FACTOR_Q_NORMAL = 0.10;
    private static final double FACTOR_Q_BAJO = 0.05;

    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;
    private final List<DestroyOperator> operadoresDestruccion;
    private final List<RepairOperator> operadoresReparacion;
    private final RandomDestroy randomDestroy;
    private final Random random;

    public IALNSAlgorithm(ConstructorSolucionesIniciales constructorSoluciones,
                          AlgoritmoSPLIT split,
                          CalculadorFitness calculadorFitness,
                          Validador validador) {
        this.constructorSoluciones = constructorSoluciones;
        this.split = split;
        this.calculadorFitness = calculadorFitness;
        this.validador = validador;
        this.random = new Random();
        this.randomDestroy = new RandomDestroy();
        this.operadoresDestruccion = List.of(
                randomDestroy,
                new SimilarityDestroy(),
                new MaxSavingCostDestroy(),
                new DestroyingVehicleDestroy(),
                new MaxWaitingTimeDestroy());
        this.operadoresReparacion = List.of(
                new GlobalOptimalRepair(),
                new MinInsertionCostRepair(),
                new RandomKRepair(),
                new RegretCriterionRepair(),
                new MinWaitingTimeRepair());
    }

    public Individuo ejecutar(List<Envio> envios,
                              int epocaActual,
                              int totalEpocas,
                              int tamanoPoblacion,
                              Duration limiteTiempo) {
        if (envios == null || envios.isEmpty()) {
            Individuo vacio = new Individuo();
            vacio.setEpoca(epocaActual);
            vacio.setEsFactible(true);
            return vacio;
        }

        IALNSContext ctx = new IALNSContext(split, calculadorFitness, validador, epocaActual, totalEpocas);
        Individuo solucionInicial = construirSolucionInicial(envios, epocaActual, totalEpocas, tamanoPoblacion, ctx);

        IALNSState estado = new IALNSState(operadoresDestruccion.size(), operadoresReparacion.size());
        estado.reset(solucionInicial);
        randomDestroy.setFactorQ(estado.getFactorQ());

        int iteracionesSinMejora = 0;
        int mejorasConsecutivas = 0;
        Instant inicio = Instant.now();

        log.info("IALNS iniciando - Época {}/{}, {} envíos, límite: {}s",
                epocaActual, totalEpocas, envios.size(), Math.max(1, limiteTiempo.getSeconds()));

        while (estado.temperaturaActiva()
                && Duration.between(inicio, Instant.now()).compareTo(limiteTiempo) < 0) {
            estado.setIteracion(estado.getIteracion() + 1);

            int indiceDestruccion = estado.seleccionarDestruccion(random);
            int indiceReparacion = estado.seleccionarReparacion(random);

            DestroyOperator.ResultadoDestruccion destruccion = operadoresDestruccion.get(indiceDestruccion)
                    .destruir(estado.getActual(), estado.getIteracion(), random);

            Individuo nueva = operadoresReparacion.get(indiceReparacion)
                    .reparar(destruccion.solucionDestruida(), destruccion.enviosRemovidos(), ctx, estado.getIteracion(), random);
            ctx.evaluar(nueva);

            estado.actualizarScoreDestruccion(indiceDestruccion, nueva);
            estado.actualizarScoreReparacion(indiceReparacion, nueva);

            if (estado.esMejor(nueva, estado.getMejorGlobal())) {
                estado.setMejorGlobal(nueva.clonar());
                mejorasConsecutivas++;
                iteracionesSinMejora = 0;
            } else {
                iteracionesSinMejora++;
                mejorasConsecutivas = 0;
            }

            if (estado.aceptar(nueva, random)) {
                estado.setActual(nueva.clonar());
            }

            if (estado.getIteracion() % UPDATE_INTERVAL == 0) {
                estado.actualizarPesos(ALPHA);
                ajustarFactorQ(estado, iteracionesSinMejora, mejorasConsecutivas);
            }

            estado.enfriar();
        }

        log.info("IALNS finalizado - {} iteraciones. Mejor: {}",
                estado.getIteracion(), estado.getMejorGlobal());
        return estado.getMejorGlobal().clonar();
    }

    private Individuo construirSolucionInicial(List<Envio> envios,
                                               int epocaActual,
                                               int totalEpocas,
                                               int tamanoPoblacion,
                                               IALNSContext ctx) {
        List<Individuo> candidatos = new ArrayList<>(constructorSoluciones.generarPoblacionInicial(
                envios,
                epocaActual,
                totalEpocas,
                Math.max(3, tamanoPoblacion)));

        if (candidatos.isEmpty()) {
            candidatos.add(constructorSoluciones.generarGreedy(envios, epocaActual, totalEpocas));
        }

        for (Individuo candidato : candidatos) {
            normalizarCoberturaCompleta(candidato, envios);
            ctx.evaluar(candidato);
        }

        return candidatos.stream()
                .min(Comparator.comparingInt((Individuo ind) -> ind.isEsFactible() ? 0 : 1)
                        .thenComparingDouble(Individuo::getFitness))
                .map(Individuo::clonar)
                .orElseGet(() -> {
                    Individuo fallback = constructorSoluciones.generarGreedy(envios, epocaActual, totalEpocas);
                    normalizarCoberturaCompleta(fallback, envios);
                    ctx.evaluar(fallback);
                    return fallback;
                });
    }

    private void normalizarCoberturaCompleta(Individuo solucion, List<Envio> envios) {
        LinkedHashSet<Envio> orden = new LinkedHashSet<>();
        // La representacion gigante es el GiantTour
        if (solucion.getRepresentacionGigante() != null) {
            orden.addAll(solucion.getRepresentacionGigante());
        }
        orden.addAll(envios);
        solucion.setRepresentacionGigante(new ArrayList<>(orden));
        IALNSSolutionSupport.normalizarSolucion(solucion);
    }

    private void ajustarFactorQ(IALNSState estado, int sinMejora, int conMejora) {
        if (sinMejora >= UMBRAL_SIN_MEJORA) {
            estado.setFactorQ(FACTOR_Q_ALTO);
        } else if (conMejora >= UMBRAL_CON_MEJORA) {
            estado.setFactorQ(FACTOR_Q_BAJO);
        } else {
            estado.setFactorQ(FACTOR_Q_NORMAL);
        }
        randomDestroy.setFactorQ(estado.getFactorQ());
    }
}