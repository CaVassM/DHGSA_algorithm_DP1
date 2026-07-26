package com.tasfb2b.dhgs.demo.domain.service;

import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Cancelación de vuelos (P&R P9).
 *
 * <p>Cancelar es marcar <b>una ocurrencia concreta</b> de un vuelo recurrente
 * como no operativa. No toca la plantilla: el mismo vuelo vuelve a operar al día
 * siguiente sin necesidad de reactivarlo.
 *
 * <p>La cancelación tiene dos efectos, y hacen falta los dos:
 * <ol>
 *   <li>El vuelo deja de estar disponible para la planificación, de modo que
 *       ninguna ruta nueva pase por él (lo resuelve {@code estaOperable()}).</li>
 *   <li>Las maletas que ya lo tenían asignado <b>quedan disponibles para ser
 *       nuevamente planificadas</b>: se sacan de la solución vigente y vuelven al
 *       conjunto de pendientes, que es lo que la siguiente época replanifica.</li>
 * </ol>
 *
 * <p>Sin el segundo efecto la maleta se quedaría asignada a un vuelo que no
 * despega, que es justo lo que la prueba del profesor comprueba.
 */
public final class CancelacionVuelos {

    private CancelacionVuelos() {
    }

    /** Resultado de aplicar una cancelación, para poder informarla. */
    public record Resultado(
            InstanciaVuelo instancia,
            List<Envio> enviosLiberados,
            int maletasLiberadas
    ) {
        public boolean seAplico() {
            return instancia != null;
        }
    }

    /**
     * Cancela la ocurrencia de {@code idPlantilla} que corresponda al momento
     * {@code ahora} y libera los envíos que la usaban.
     *
     * @param grafo        grafo con las instancias del horizonte
     * @param idPlantilla  identificador del vuelo recurrente a cancelar
     * @param ahora        momento en que se registra la cancelación. En la
     *                     simulación es el <b>reloj simulado</b>, no la hora real:
     *                     la regla de la antelación mínima se mide contra el
     *                     tiempo en el que transcurre la operación.
     * @param solucion     solución vigente de la época, de donde se retiran los
     *                     envíos afectados. Puede ser {@code null} si todavía no
     *                     se ha planificado nada.
     * @return qué instancia se canceló y qué envíos quedaron libres; con
     *         {@code instancia == null} si ninguna ocurrencia podía cancelarse.
     */
    public static Resultado cancelar(GrafoVuelos grafo, String idPlantilla,
                                     LocalDateTime ahora, Individuo solucion) {
        InstanciaVuelo instancia = grafo.resolverInstanciaACancelar(idPlantilla, ahora);
        if (instancia == null) {
            return new Resultado(null, Collections.emptyList(), 0);
        }
        instancia.setCancelado(true);
        List<Envio> liberados = liberarEnvios(instancia, solucion);
        int maletas = liberados.stream().mapToInt(Envio::getCantidadMaletas).sum();
        return new Resultado(instancia, liberados, maletas);
    }

    /**
     * Retira de la solución los envíos cuya ruta pasa por {@code cancelada} y
     * devuelve la capacidad que ocupaban en el <b>resto</b> de tramos de esa ruta.
     *
     * <p>Devolver la capacidad importa: esos asientos ya no los usa nadie, y si
     * no se liberan, los vuelos sanos de la ruta rota quedan ocupados por maletas
     * que nunca van a viajar en ellos y la replanificación los encuentra llenos.
     *
     * <p>No se devuelve capacidad al vuelo cancelado: no opera, su ocupación deja
     * de tener sentido.
     */
    private static List<Envio> liberarEnvios(InstanciaVuelo cancelada, Individuo solucion) {
        if (solucion == null || solucion.getEnviosAsignados() == null) {
            return Collections.emptyList();
        }

        List<Envio> liberados = new ArrayList<>();
        Iterator<Map.Entry<Envio, RutaEnvio>> it = solucion.getEnviosAsignados().entrySet().iterator();

        while (it.hasNext()) {
            Map.Entry<Envio, RutaEnvio> asignacion = it.next();
            RutaEnvio ruta = asignacion.getValue();
            if (ruta == null || ruta.getSecuenciaVuelos() == null) {
                continue;
            }
            if (!ruta.getSecuenciaVuelos().contains(cancelada)) {
                continue;
            }

            Envio envio = asignacion.getKey();
            for (Vuelo tramo : ruta.getSecuenciaVuelos()) {
                if (tramo != cancelada) {
                    tramo.liberarCapacidad(envio.getCantidadMaletas());
                }
            }
            it.remove();
            liberados.add(envio);
        }
        return liberados;
    }
}
