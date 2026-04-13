package com.TasfB2B.DHGS.demo.algorithm.dhgs;

import com.TasfB2B.DHGS.demo.algorithm.operators.*;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import com.TasfB2B.DHGS.demo.domain.valueobject.ParametrosPenalizacion;
import com.TasfB2B.DHGS.demo.infraestructure.util.AlgoritmoSPLIT;
import com.TasfB2B.DHGS.demo.infraestructure.util.CalculadorFitness;
import com.TasfB2B.DHGS.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.TasfB2B.DHGS.demo.infraestructure.util.Validador;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Algoritmo principal DHGS (Dynamic Hybrid Genetic Search) adaptado a Tasf.B2B.
 *
 * ENTRADA POR ÉPOCA:
 * - epocaActual, totalEpocas
 * - envios (must-go + opcionales)
 * - límite de tiempo
 *
 * SALIDA:
 * - Mejor individuo (solución) con envíos a despachar y rutas óptimas
 *
 * FLUJO:
 * 1. Preparación de datos
 * 2. Inicialización de población
 * 3. Loop genético (selección → crossover → local search → evaluación → gestión)
 * 4. Retorno de mejor solución
 *
 * FITNESS = distanciaTotal + 1000 × Σmax(0, carga−cap)² + 5000 × Σmax(0, retraso)²
 */
public class DHGSAlgorithm {

    private static final Logger log = LoggerFactory.getLogger(DHGSAlgorithm.class);
    private static final int ITERACIONES_AJUSTE_PENALIZACION = 100;

    // Componentes
    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;

    // Operadores genéticos
    private final CrossoverOperator crossover;
    private final List<LocalSearch> operadoresLocalSearch;

    // Parámetros
    private final ParametrosPenalizacion parametros;

    public DHGSAlgorithm(ConstructorSolucionesIniciales constructorSoluciones,
                         AlgoritmoSPLIT split,
                         CalculadorFitness calculadorFitness,
                         Validador validador) {
        this.constructorSoluciones = constructorSoluciones;
        this.split = split;
        this.calculadorFitness = calculadorFitness;
        this.validador = validador;
        this.parametros = new ParametrosPenalizacion();

        // Inicializar operadores
        this.crossover = new OXCrossover();
        this.operadoresLocalSearch = List.of(
                new LocalSearchDelete(),
                new LocalSearchAdd(),
                new LocalSearchSwapOut(),
                new LocalSearchRelocate(),
                new LocalSearchSwap(),
                new LocalSearch2Opt()
        );
    }

    /**
     * Ejecuta el algoritmo DHGS para una época.
     *
     * @param envios          todos los envíos disponibles (must-go + opcionales)
     * @param epocaActual     número de la época actual
     * @param totalEpocas     total de épocas
     * @param tamanoPoblacion tamaño de la población
     * @param limiteTiempo    límite de tiempo para la ejecución
     * @return mejor solución encontrada
     */
    public Individuo ejecutar(List<Envio> envios, int epocaActual, int totalEpocas,
                              int tamanoPoblacion, Duration limiteTiempo) {

        log.info("DHGS iniciando - Época {}/{}, {} envíos, límite: {}s",
                epocaActual, totalEpocas, envios.size(), limiteTiempo.getSeconds());

        Instant inicio = Instant.now();

        // Crear contexto para operadores de búsqueda local
        LocalSearchContext ctx = new LocalSearchContext(split, calculadorFitness, epocaActual, totalEpocas);

        // === PASO 1: PREPARACIÓN ===
        // (must-go ya actualizado por SimuladorEpocas)

        // === PASO 2: INICIALIZACIÓN DE POBLACIÓN ===
        List<Individuo> poblacionInicial = constructorSoluciones.generarPoblacionInicial(
                envios, epocaActual, totalEpocas, tamanoPoblacion);

        Poblacion poblacion = new Poblacion();
        for (Individuo ind : poblacionInicial) {
            poblacion.agregar(ind);
        }

        log.info("Población inicial: {}", poblacion);

        // === PASO 3: LOOP GENÉTICO ===
        int iteracion = 0;
        boolean tiempoAgotado = false;

        while (!tiempoAgotado) {
            iteracion++;

            // Verificar tiempo
            Duration transcurrido = Duration.between(inicio, Instant.now());
            if (transcurrido.compareTo(limiteTiempo) >= 0) {
                tiempoAgotado = true;
                break;
            }

            // Verificar estancamiento
            if (poblacion.estaEstancada(0.001)) {
                log.info("Población estancada en iteración {}", iteracion);
                break;
            }

            try {
                // --- 3.1 SELECCIÓN DE PADRES ---
                Poblacion.Par<Individuo, Individuo> padres = poblacion.seleccionarPadres();

                // --- 3.2 CROSSOVER ---
                Individuo hijo = crossover.cruzar(padres.primero(), padres.segundo());

                // Aplicar SPLIT para crear rutas desde el giant tour del hijo
                Map<Envio, RutaEnvio> asignaciones = split.split(hijo.getRepresentacionGigante());
                hijo.setEnviosAsignados(asignaciones);

                // Determinar no asignados
                List<Envio> noAsignados = new ArrayList<>();
                for (Envio e : envios) {
                    if (!asignaciones.containsKey(e)) {
                        noAsignados.add(e);
                    }
                }
                hijo.setEnviosNoAsignados(noAsignados);

                // --- 3.3 LOCAL SEARCH (con contexto) ---
                for (LocalSearch ls : operadoresLocalSearch) {
                    hijo = ls.aplicar(hijo, ctx);
                }

                // --- 3.4 EVALUACIÓN ---
                calculadorFitness.calcularViolaciones(hijo);
                calculadorFitness.calcular(hijo, epocaActual, totalEpocas);
                hijo.validarFactibilidad();

                // --- 3.5 GESTIÓN DE POBLACIÓN ---
                poblacion.agregar(hijo);

                // --- 3.6 AJUSTE DE PENALIZACIONES ---
                if (iteracion % ITERACIONES_AJUSTE_PENALIZACION == 0) {
                    parametros.ajustar(poblacion.getRatioFactibles());
                    calculadorFitness.setParametros(parametros);
                    log.debug("Iteración {}: ratio factibles={}, params={}",
                            iteracion, String.format("%.2f", poblacion.getRatioFactibles()), parametros);
                }

            } catch (Exception e) {
                log.warn("Error en iteración {}: {}", iteracion, e.getMessage());
            }
        }

        // === PASO 4: RETORNO DE MEJOR SOLUCIÓN ===
        Individuo mejor = poblacion.getMejorHistorico();

        if (mejor == null && !poblacion.getFactibles().isEmpty()) {
            mejor = poblacion.getFactibles().stream()
                    .min(Comparator.comparingDouble(Individuo::getFitness))
                    .orElse(null);
        }

        if (mejor == null && !poblacion.getInfactibles().isEmpty()) {
            mejor = poblacion.getInfactibles().stream()
                    .min(Comparator.comparingDouble(Individuo::getFitness))
                    .orElse(null);
        }

        Duration tiempoTotal = Duration.between(inicio, Instant.now());
        log.info("DHGS finalizado - {} iteraciones en {}ms. Mejor: {}",
                iteracion, tiempoTotal.toMillis(), mejor);

        return mejor;
    }
}
