package com.tasfb2b.dhgs.demo.algorithm.operators;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Envio;

import java.util.*;

/**
 * Ordered Crossover (OX) adaptado para DHGS.
 *
 * 1. Tomar un fragmento aleatorio del giant tour del padre1
 * 2. Completar con envíos del padre2 en orden (que no estén ya)
 * 3. Garantizar que TODOS los must-go estén presentes en el hijo
 */
public class OXCrossover implements CrossoverOperator {

    @Override
    public Individuo cruzar(Individuo padre1, Individuo padre2) {
        Individuo hijo = padre1.clonar();

        List<Envio> giantTour1 = padre1.getRepresentacionGigante();
        List<Envio> giantTour2 = padre2.getRepresentacionGigante();

        if (giantTour1 == null || giantTour1.isEmpty() ||
            giantTour2 == null || giantTour2.isEmpty()) {
            return hijo;
        }

        Random random = new Random();
        int size1 = giantTour1.size();

        // Seleccionar segmento aleatorio del padre1
        int puntoCorte1 = random.nextInt(size1);
        int puntoCorte2 = random.nextInt(size1);
        if (puntoCorte1 > puntoCorte2) {
            int temp = puntoCorte1;
            puntoCorte1 = puntoCorte2;
            puntoCorte2 = temp;
        }

        // Tomar segmento del padre1
        List<Envio> segmento = new ArrayList<>(giantTour1.subList(puntoCorte1, puntoCorte2 + 1));
        Set<String> idsEnSegmento = new HashSet<>();
        for (Envio e : segmento) {
            idsEnSegmento.add(e.getId());
        }

        // Completar con envíos del padre2 que no están en el segmento
        List<Envio> nuevoGiantTour = new ArrayList<>(segmento);
        for (Envio e : giantTour2) {
            if (!idsEnSegmento.contains(e.getId())) {
                nuevoGiantTour.add(e);
                idsEnSegmento.add(e.getId());
            }
        }

        // Garantizar que todos los must-go estén presentes
        // (podrían faltar si un padre no los tenía en su giant tour)
        Set<String> idsFinales = new HashSet<>(idsEnSegmento);
        for (Envio e : giantTour1) {
            if (e.isEsMustGo() && !idsFinales.contains(e.getId())) {
                nuevoGiantTour.add(e);
                idsFinales.add(e.getId());
            }
        }
        for (Envio e : giantTour2) {
            if (e.isEsMustGo() && !idsFinales.contains(e.getId())) {
                nuevoGiantTour.add(e);
                idsFinales.add(e.getId());
            }
        }

        hijo.setRepresentacionGigante(nuevoGiantTour);
        return hijo;
    }
}
