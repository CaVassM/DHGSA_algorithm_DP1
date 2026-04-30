package com.TasfB2B.DHGS.demo.algorithm.ialns.operators.destroy;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.algorithm.ialns.IALNSSolutionSupport;
import com.TasfB2B.DHGS.demo.algorithm.ialns.operators.DestroyOperator;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import com.TasfB2B.DHGS.demo.domain.model.RutaEnvio;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Random;

public class SimilarityDestroy implements DestroyOperator {

    private final double factorD;

    public SimilarityDestroy() {
        this(3.0);
    }

    public SimilarityDestroy(double factorD) {
        this.factorD = factorD;
    }

    @Override
    public ResultadoDestruccion destruir(Individuo solucion, int iteracion, Random random) {
        List<Envio> asignados = IALNSSolutionSupport.obtenerEnviosAsignados(solucion);
        if (asignados.size() < 2) {
            return new ResultadoDestruccion(solucion.clonar(), new ArrayList<>());
        }

        int q = Math.max(1, (int) Math.ceil(asignados.size() * 0.10));
        double distanciaMax = calcularDistanciaMaxima(asignados);

        Envio semilla = asignados.get(random.nextInt(asignados.size()));
        List<Envio> removidos = new ArrayList<>();
        removidos.add(semilla);

        while (removidos.size() < q) {
            Envio base = removidos.get(random.nextInt(removidos.size()));
            List<Envio> candidatos = new ArrayList<>(asignados);
            candidatos.removeAll(removidos);
            if (candidatos.isEmpty()) {
                break;
            }

            candidatos.sort(Comparator.comparingDouble((Envio candidato) ->
                    similitud(solucion, base, candidato, distanciaMax)).reversed());

            int indice = (int) (Math.pow(random.nextDouble(), factorD) * candidatos.size());
            removidos.add(candidatos.get(Math.min(indice, candidatos.size() - 1)));
        }

        return removerEnvios(solucion, removidos);
    }

    @Override
    public String getNombre() {
        return "SimilarityDestroy";
    }

    private double similitud(Individuo solucion, Envio origen, Envio destino, double distanciaMax) {
        double distancia = 0.0;
        if (origen.getAeropuertoDestino() != null && destino.getAeropuertoDestino() != null) {
            distancia = origen.getAeropuertoDestino().getDistanciaA(destino.getAeropuertoDestino());
        }
        double distanciaNorm = distanciaMax > 0 ? distancia / distanciaMax : 0.0;
        if (distanciaNorm <= 0.0) {
            distanciaNorm = 0.001;
        }

        RutaEnvio rutaOrigen = solucion.getEnviosAsignados().get(origen);
        RutaEnvio rutaDestino = solucion.getEnviosAsignados().get(destino);
        boolean mismaRuta = rutaOrigen != null
                && rutaDestino != null
                && IALNSSolutionSupport.firmaRuta(rutaOrigen).equals(IALNSSolutionSupport.firmaRuta(rutaDestino));
        double mismaRutaFlag = mismaRuta ? 0.0 : 1.0;
        return (1.0 / distanciaNorm) + mismaRutaFlag;
    }

    private double calcularDistanciaMaxima(List<Envio> envios) {
        double max = 1.0;
        for (int i = 0; i < envios.size(); i++) {
            for (int j = i + 1; j < envios.size(); j++) {
                Envio a = envios.get(i);
                Envio b = envios.get(j);
                if (a.getAeropuertoDestino() == null || b.getAeropuertoDestino() == null) {
                    continue;
                }
                max = Math.max(max, a.getAeropuertoDestino().getDistanciaA(b.getAeropuertoDestino()));
            }
        }
        return max;
    }
}