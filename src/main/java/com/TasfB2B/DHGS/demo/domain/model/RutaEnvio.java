package com.TasfB2B.DHGS.demo.domain.model;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class RutaEnvio {
    private Envio envio; // Envio que sigue esta ruta
    private List<Vuelo> secuenciaVuelos; // Vuelos en orden. SKBO->SPIM, SPIM->SCEL
    private LocalDateTime tiempoInicio; // Cuando sale el primer aeropuerto
    private LocalDateTime tiempoLlegadaEstimado; // Cuando llegaal destino final
    private double distanciaTotal; // Suma de distancia de todos los vuelos
    private boolean esDirecta; // True si es 1 solo vuelo
    private int escalas; // Nro de vuelos - 1

    // Valida si la RutaEnvio cumple con las restricciones.
    public boolean esFactible(){
        if (envio == null || secuenciaVuelos == null || secuenciaVuelos.isEmpty()) {
            return false;
        }

        Vuelo primero = secuenciaVuelos.get(0);
        Vuelo ultimo = secuenciaVuelos.get(secuenciaVuelos.size() - 1);
        // Deben de contar con el mismo aeropuerto de origen
        if (!mismoAeropuerto(primero.getAeropuertoOrigen(), envio.getAeropuertoOrigen())) {
            return false;
        }
        // Deben de contar con el mismo aeropuerto de destino
        if (!mismoAeropuerto(ultimo.getAeropuertoDestino(), envio.getAeropuertoDestino())) {
            return false;
        }

        // Ahora se verifica conexiones
        for (int i = 0; i < secuenciaVuelos.size() - 1; i++) {
            Vuelo actual = secuenciaVuelos.get(i);
            Vuelo siguiente = secuenciaVuelos.get(i + 1);
            if (!mismoAeropuerto(actual.getAeropuertoDestino(), siguiente.getAeropuertoOrigen())) {
                return false;
            }
        }

        calcularTiempos();
        // Ahora verificamos que no se haya calculado el deadline, y tambien si esque el tiempo de llegda
        // no es luego del deadline. Toca aclarar esto.
        return envio.getDeadline() == null || !tiempoLlegadaEstimado.isAfter(envio.getDeadline());

    }

    // Si viola deadline
    public long getRetraso(){
        if (envio == null || envio.getDeadline() == null || tiempoLlegadaEstimado == null) {
            return 0;
        }
        if (!tiempoLlegadaEstimado.isAfter(envio.getDeadline())) {
            return 0;
        }
        return Duration.between(envio.getDeadline(), tiempoLlegadaEstimado).toMinutes();

    }

    // Distancia * maletas, asi va a ser el costo.
    public double getCosto(){
        if (envio == null) {
            return 0;
        }
        return distanciaTotal * Math.max(0, envio.getCantidadMaletas());

    }

    // Recalcula tiempo inicio y tiempoLlegadaEstimado basandose en la seucencia de vuelos y horarios.
    // Cuando se modifica un ruta, los tiempos se invalidan. este metodo lo recalcula.
    // Util para cuando sea aplica operadores de local search que modifican la ruta.
    // Ahh de toda la secuencia obtenida en dijkstra, saca el inicio y salida.
    public void calcularTiempos() {
        // Lo mismo que el anterior
        if (envio == null || envio.getFechaHoraCreacion() == null || secuenciaVuelos == null || secuenciaVuelos.isEmpty()) {
            return;
        }

        LocalDateTime momentoActual = envio.getFechaHoraCreacion();
        double distanciaAcumulada = 0;

        for (int i = 0; i < secuenciaVuelos.size(); i++) {
            Vuelo vuelo = secuenciaVuelos.get(i);
            LocalDateTime salida = ajustarSalida(momentoActual, vuelo.getHoraSalida());
            Duration duracionVuelo = vuelo.getDuracion() != null
                    ? vuelo.getDuracion()
                    : Duration.ofMinutes(vuelo.getTiempoVuelo());
            LocalDateTime llegada = salida.plus(duracionVuelo);

            if (i == 0) {
                this.tiempoInicio = salida;
            }

            momentoActual = llegada;
            distanciaAcumulada += vuelo.getDistancia();
        }

        this.tiempoLlegadaEstimado = momentoActual;
        this.distanciaTotal = distanciaAcumulada;
        this.esDirecta = secuenciaVuelos.size() == 1;
        this.escalas = Math.max(0, secuenciaVuelos.size() - 1);
    }

    public RutaEnvio clonar() {
        RutaEnvio copia = new RutaEnvio();
        copia.setEnvio(this.envio);
        copia.setSecuenciaVuelos(this.secuenciaVuelos == null ? new ArrayList<>() : new ArrayList<>(this.secuenciaVuelos));
        copia.setTiempoInicio(this.tiempoInicio);
        copia.setTiempoLlegadaEstimado(this.tiempoLlegadaEstimado);
        copia.setDistanciaTotal(this.distanciaTotal);
        copia.setEsDirecta(this.esDirecta);
        copia.setEscalas(this.escalas);
        return copia;
    }

    // Toma una hora de vuelo y la convierte en una fecha y hora completas
    // 2026-01-02 00:47 como referencia. El sistema crea 2026-01-02 03:34
    private LocalDateTime ajustarSalida(LocalDateTime referencia, LocalTime horaSalida) {
        LocalDateTime salida = LocalDateTime.of(referencia.toLocalDate(), horaSalida);
        // Suma 1 dia hasta que tenga sentido.
        while (salida.isBefore(referencia)) {
            salida = salida.plusDays(1);
        }
        return salida;
    }

    private boolean mismoAeropuerto(Aeropuerto a1, Aeropuerto a2) {
        return a1 != null
                && a2 != null
                && a1.getCodigoICAO() != null
                && a1.getCodigoICAO().equals(a2.getCodigoICAO());

    }

}
