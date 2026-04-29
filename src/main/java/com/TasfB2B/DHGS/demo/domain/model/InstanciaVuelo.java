package com.TasfB2B.DHGS.demo.domain.model;

import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Objects;

/**
 * Instancia fechada de un vuelo recurrente.
 * Representa la ocurrencia concreta de una plantilla de vuelo en un día del horizonte.
 */
@Getter
@Setter
@NoArgsConstructor
public class InstanciaVuelo extends Vuelo {

    private String idPlantilla;
    private LocalDate fechaOperacion;
    private LocalDateTime fechaHoraSalida;
    private LocalDateTime fechaHoraLlegada;

    public static InstanciaVuelo desdePlantilla(Vuelo plantilla, LocalDate fechaOperacion) {
        InstanciaVuelo instancia = new InstanciaVuelo();
        instancia.setIdPlantilla(plantilla.getId());
        instancia.setFechaOperacion(fechaOperacion);
        instancia.setId(String.format("%s@%s", plantilla.getId(), fechaOperacion));
        instancia.setAeropuertoOrigen(plantilla.getAeropuertoOrigen());
        instancia.setAeropuertoDestino(plantilla.getAeropuertoDestino());
        instancia.setHoraSalida(plantilla.getHoraSalida());
        instancia.setHoraLlegada(plantilla.getHoraLlegada());
        instancia.setCapacidad(plantilla.getCapacidad());
        instancia.setCapacidadDisponible(plantilla.getCapacidad());
        instancia.setDistancia(plantilla.getDistancia());

        Duration duracion = plantilla.getDuracion() != null
                ? plantilla.getDuracion()
                : Duration.ofMinutes(plantilla.getTiempoVuelo());
        instancia.setDuracion(duracion);

        LocalDateTime salida = LocalDateTime.of(fechaOperacion, plantilla.getHoraSalida());
        instancia.setFechaHoraSalida(salida);
        instancia.setFechaHoraLlegada(salida.plus(duracion));
        return instancia;
    }

    @Override
    public long getTiempoVuelo() {
        if (getFechaHoraSalida() != null && getFechaHoraLlegada() != null) {
            Duration duracion = Duration.between(getFechaHoraSalida(), getFechaHoraLlegada());
            setDuracion(duracion);
            return duracion.toMinutes();
        }
        return super.getTiempoVuelo();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof InstanciaVuelo that)) {
            return false;
        }
        return Objects.equals(getId(), that.getId());
    }

    @Override
    public int hashCode() {
        return Objects.hash(getId());
    }
}
