package com.TasfB2B.DHGS.demo.infraestructure.util;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Genera la población inicial de soluciones para el algoritmo DHGS.
 *
 * Estrategias de generación:
 * - Greedy: asignar todos los envíos por camino más corto
 * - Lazy: asignar solo must-go
 * - Aleatorias: permutaciones aleatorias con subconjuntos de opcionales
 *   (probabilidades p = 0.0, 0.1, 0.5, 1.0)
 */
@Component
public class ConstructorSolucionesIniciales {

    private final GrafoVuelos grafoVuelos;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;

    public ConstructorSolucionesIniciales(GrafoVuelos grafoVuelos,
                                          AlgoritmoSPLIT split,
                                          CalculadorFitness calculadorFitness) {
        this.grafoVuelos = grafoVuelos;
        this.split = split;
        this.calculadorFitness = calculadorFitness;
    }

    /**
     * Genera la población inicial completa.
     *
     * @param envios      todos los envíos disponibles (must-go + opcionales)
     * @param epoca       época actual
     * @param totalEpocas total de épocas en la simulación
     * @param tamano      tamaño deseado de la población (ej: 25)
     * @return lista de individuos para la población inicial
     */
    public List<Individuo> generarPoblacionInicial(List<Envio> envios, int epoca,
                                                    int totalEpocas, int tamano) {
        List<Individuo> poblacion = new ArrayList<>();

        if (envios == null || envios.isEmpty()) return poblacion;

        // 1. Generar solución greedy (todos los envíos)
        poblacion.add(generarGreedy(envios, epoca, totalEpocas));

        // 2. Generar solución lazy (solo must-go)
        poblacion.add(generarLazy(envios, epoca, totalEpocas));

        // 3. Generar soluciones aleatorias con diferentes probabilidades de inclusión
        double[] probabilidades = {0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0};
        Random random = new Random();

        while (poblacion.size() < tamano) {
            double prob = probabilidades[random.nextInt(probabilidades.length)];
            Individuo aleatorio = generarAleatorio(envios, prob, epoca, totalEpocas, random);
            poblacion.add(aleatorio);
        }

        return poblacion;
    }

    /**
     * Genera una solución greedy: asigna TODOS los envíos por camino más corto.
     * Ordena por prioridad (más urgentes primero).
     */
    public Individuo generarGreedy(List<Envio> envios, int epoca, int totalEpocas) {
        LocalDateTime ahora = LocalDateTime.now();

        // Ordenar por prioridad descendente
        List<Envio> ordenados = envios.stream()
                .sorted((a, b) -> Integer.compare(
                        b.calcularPrioridad(ahora),
                        a.calcularPrioridad(ahora)))
                .collect(Collectors.toList());

        Individuo individuo = new Individuo();
        individuo.setEpoca(epoca);
        individuo.setRepresentacionGigante(new ArrayList<>(ordenados));

        // Aplicar SPLIT para asignar rutas
        Map<Envio, RutaEnvio> asignaciones = split.split(ordenados);
        individuo.setEnviosAsignados(asignaciones);

        // Envíos sin ruta van a no asignados
        List<Envio> noAsignados = new ArrayList<>();
        for (Envio e : ordenados) {
            if (!asignaciones.containsKey(e)) {
                noAsignados.add(e);
            }
        }
        individuo.setEnviosNoAsignados(noAsignados);

        // Calcular fitness
        calculadorFitness.calcularViolaciones(individuo);
        calculadorFitness.calcular(individuo, epoca, totalEpocas);

        return individuo;
    }

    /**
     * Genera una solución lazy: asigna SOLO los envíos must-go.
     * Los opcionales se dejan sin asignar (para postponer).
     */
    public Individuo generarLazy(List<Envio> envios, int epoca, int totalEpocas) {
        List<Envio> mustGo = envios.stream()
                .filter(Envio::isEsMustGo)
                .collect(Collectors.toList());

        List<Envio> opcionales = envios.stream()
                .filter(e -> !e.isEsMustGo())
                .collect(Collectors.toList());

        Individuo individuo = new Individuo();
        individuo.setEpoca(epoca);
        individuo.setRepresentacionGigante(new ArrayList<>(mustGo));

        Map<Envio, RutaEnvio> asignaciones = split.split(mustGo);
        individuo.setEnviosAsignados(asignaciones);

        // No asignados = opcionales + must-go sin ruta
        List<Envio> noAsignados = new ArrayList<>(opcionales);
        for (Envio e : mustGo) {
            if (!asignaciones.containsKey(e)) {
                noAsignados.add(e);
            }
        }
        individuo.setEnviosNoAsignados(noAsignados);

        calculadorFitness.calcularViolaciones(individuo);
        calculadorFitness.calcular(individuo, epoca, totalEpocas);

        return individuo;
    }

    /**
     * Genera una solución aleatoria.
     * Incluye todos los must-go + un subconjunto aleatorio de opcionales.
     *
     * @param probabilidadInclusion probabilidad de incluir cada envío opcional (0.0 a 1.0)
     */
    public Individuo generarAleatorio(List<Envio> envios, double probabilidadInclusion,
                                       int epoca, int totalEpocas, Random random) {
        List<Envio> seleccionados = new ArrayList<>();
        List<Envio> noSeleccionados = new ArrayList<>();

        for (Envio e : envios) {
            if (e.isEsMustGo() || random.nextDouble() < probabilidadInclusion) {
                seleccionados.add(e);
            } else {
                noSeleccionados.add(e);
            }
        }

        // Permutar aleatoriamente el orden (diversidad en el giant tour)
        Collections.shuffle(seleccionados, random);

        Individuo individuo = new Individuo();
        individuo.setEpoca(epoca);
        individuo.setRepresentacionGigante(new ArrayList<>(seleccionados));

        Map<Envio, RutaEnvio> asignaciones = split.split(seleccionados);
        individuo.setEnviosAsignados(asignaciones);

        // No asignados: los no seleccionados + seleccionados sin ruta
        List<Envio> noAsignados = new ArrayList<>(noSeleccionados);
        for (Envio e : seleccionados) {
            if (!asignaciones.containsKey(e)) {
                noAsignados.add(e);
            }
        }
        individuo.setEnviosNoAsignados(noAsignados);

        calculadorFitness.calcularViolaciones(individuo);
        calculadorFitness.calcular(individuo, epoca, totalEpocas);

        return individuo;
    }
}

