package com.tasfb2b.dhgs.demo.domain.valueobject;

import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * Conversión entre la hora local de un aeropuerto y el instante absoluto.
 *
 * <p>Cada aeropuerto opera en su propio huso ({@code Aeropuerto.gmt}), y en la
 * operación día a día eso deja de ser un detalle: cuatro terminales registrando
 * a la vez desde Lima (GMT-5), Buenos Aires (GMT-3), Copenhague (GMT+2) y Delhi
 * (GMT+5) están en el mismo instante pero marcan cuatro horas de pared distintas.
 *
 * <p>Guardar la hora de pared sin más las volvería incomparables: un envío
 * registrado en Delhi a las 09:00 parecería posterior a uno de Lima a las 23:00
 * del día anterior, cuando en realidad son casi simultáneos. Por eso todo lo que
 * se compara o se ordena (plazos, salidas de vuelo) vive en un instante común, y
 * la hora local se usa solo para mostrar y para leer lo que teclea el operador.
 *
 * <p>El instante común se representa como {@code LocalDateTime} en UTC, que es
 * el tipo que ya usan el modelo y la base de datos.
 */
public final class HoraLocal {

    private HoraLocal() {
    }

    /** Desfase horario del aeropuerto respecto a UTC. */
    public static ZoneOffset offsetDe(Aeropuerto aeropuerto) {
        int horas = aeropuerto != null ? aeropuerto.getGmt() : 0;
        // Acota a lo que admite ZoneOffset (±18 h) para que un dato corrupto en
        // la BD no tumbe el registro con una excepción.
        return ZoneOffset.ofHours(Math.max(-18, Math.min(18, horas)));
    }

    /**
     * Hora de pared del aeropuerto → instante absoluto (UTC).
     *
     * <p>Es la conversión que se aplica a lo que teclea el operador: él escribe
     * la hora de su reloj, y el sistema la sitúa en la línea de tiempo global.
     */
    public static LocalDateTime aUtc(LocalDateTime horaLocal, Aeropuerto aeropuerto) {
        if (horaLocal == null) {
            return null;
        }
        return horaLocal.minusSeconds(offsetDe(aeropuerto).getTotalSeconds());
    }

    /**
     * Instante absoluto (UTC) → hora de pared del aeropuerto.
     *
     * <p>Es la conversión de salida: los plazos y las horas de vuelo se muestran
     * en la hora del aeropuerto que corresponda, no en la del servidor.
     */
    public static LocalDateTime aLocal(LocalDateTime utc, Aeropuerto aeropuerto) {
        if (utc == null) {
            return null;
        }
        return utc.plusSeconds(offsetDe(aeropuerto).getTotalSeconds());
    }

    /** "Ahora" en la hora de pared del aeropuerto, sea cual sea el reloj del servidor. */
    public static LocalDateTime ahoraEn(Aeropuerto aeropuerto) {
        return LocalDateTime.ofInstant(Instant.now(), offsetDe(aeropuerto));
    }

    /** "Ahora" como instante absoluto (UTC). */
    public static LocalDateTime ahoraUtc() {
        return LocalDateTime.ofInstant(Instant.now(), ZoneOffset.UTC);
    }

    /** Etiqueta del huso para mostrar junto a una hora ("GMT-5", "GMT+2"). */
    public static String etiquetaGmt(Aeropuerto aeropuerto) {
        int horas = aeropuerto != null ? aeropuerto.getGmt() : 0;
        return String.format("GMT%+d", horas);
    }

    /**
     * Diferencia horaria entre dos aeropuertos, para explicar por qué la hora de
     * llegada no encaja con la de salida cuando se cruzan husos.
     */
    public static Duration desfaseEntre(Aeropuerto origen, Aeropuerto destino) {
        return Duration.ofSeconds(
                offsetDe(destino).getTotalSeconds() - offsetDe(origen).getTotalSeconds());
    }
}
