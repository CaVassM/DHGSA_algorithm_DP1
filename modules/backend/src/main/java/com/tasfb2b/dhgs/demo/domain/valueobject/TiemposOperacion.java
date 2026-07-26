package com.tasfb2b.dhgs.demo.domain.valueobject;

import java.time.Duration;

/**
 * Tiempos mínimos de operación de las maletas en los aeropuertos, según la hoja
 * de Preguntas y Respuestas del proyecto (P6/P7):
 *
 * <ul>
 *   <li><b>Escala</b>: tiempo mínimo de permanencia de una maleta en un
 *       aeropuerto intermedio entre la llegada de un vuelo y la salida del
 *       siguiente (transbordo) = <b>10 minutos</b>.</li>
 *   <li><b>Recojo en destino final</b>: tiempo que transcurre entre que la
 *       maleta queda en el almacén del aeropuerto destino y es recogida por el
 *       cliente = <b>15 minutos</b> (actualizado 16-jun-2026; antes 10).</li>
 *   <li><b>Manipulación avión↔almacén</b>: 0 en ambos sentidos (P7).</li>
 * </ul>
 *
 * Son parámetros: si el enunciado los cambia, ajustar aquí y se propaga a todo
 * el motor (búsqueda de rutas y validación de factibilidad).
 */
public final class TiemposOperacion {

    /** Tiempo mínimo de escala/transbordo en aeropuerto intermedio. */
    public static final Duration ESCALA_MINIMA = Duration.ofMinutes(10);

    /** Tiempo de recojo de la maleta en el aeropuerto destino final. */
    public static final Duration RECOJO_DESTINO = Duration.ofMinutes(15);

    /**
     * Antelación mínima con la que se puede cancelar un vuelo del día (P&R P9,
     * 17-jun-2026): una cancelación registrada a menos de 1 hora de la salida ya
     * no alcanza a esa salida y recae sobre la ocurrencia del día siguiente.
     *
     * <p>De los tres casos del enunciado sale una única regla: la cancelación
     * afecta a <b>la próxima ocurrencia del vuelo que salga con al menos esta
     * antelación</b>. Para un vuelo de las 18:25, cancelar a las 13:30 o a las
     * 17:25 alcanza al de hoy; a las 17:26 o a las 20:02, al de mañana.
     */
    public static final Duration ANTELACION_MINIMA_CANCELACION = Duration.ofHours(1);

    private TiemposOperacion() {
    }
}
