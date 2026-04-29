package com.TasfB2B.DHGS.demo.domain.model;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.Objects;


// La clase envio representa una solicitud de transporte de maletas.
// Lo que el algoritmo debe de planiicar (asignar a vuelos).
// Un envio es un paquete de trabajo que contiene N maletas que van al mismo destino.
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class Envio {
    private String id;
    private Aeropuerto aeropuertoOrigen;
    private Aeropuerto aeropuertoDestino;
    private LocalDateTime fechaHoraCreacion;
    private int cantidadMaletas; // Cuantas maletas contiene el envio
    private String idCliente; // Aerolinea que lo solicita
    private LocalDateTime deadline; // Fecha/hora limite de entrega. NO SE PUEDE VIOLAR
    private boolean esMustGo; // Si debe despacharse en epoca actual
    private int prioridad; // Calculado segun urgencia
    private static final long MARGEN_MUST_GO_HORAS = 8; // Por que 8?

    // Calcla fecha/hora limite de entrega basandose en si es mismo o distinto continente.
    public LocalDateTime calcularDeadline(){
        if (fechaHoraCreacion == null || aeropuertoOrigen == null || aeropuertoDestino == null) {
            return null;
        }

        // 1 dia si es local, si es internacional, 2 dias.
        this.deadline = aeropuertoOrigen.estaMismoContinente(aeropuertoDestino)
                ? fechaHoraCreacion.plusDays(1)
                : fechaHoraCreacion.plusDays(2);

        return this.deadline;
    }

    // Calcula cuanto tiempo falta para el deadline desde un momento dado.
    // Util para saber que tan urgente es un envio. Un envio con 2h restantes es mas urgente que uno con 20 Horas.
    public Duration getTiempoRestante(LocalDateTime momento){
        if (deadline == null) {
            calcularDeadline();
        }
        if (deadline == null) {
            return Duration.ZERO;
        }
        LocalDateTime referencia = momento == null ? LocalDateTime.now() : momento;
        return Duration.between(referencia, deadline);
    }

    public Duration getTiempoRestante(){
        return getTiempoRestante(LocalDateTime.now());
    }

    public void actualizarMustGo(){
        actualizarMustGo(LocalDateTime.now(), MARGEN_MUST_GO_HORAS);
    }

    // Recalcula si el envio debe marcarse como MUST GO basandose en la epoca actual y en el tiempo restante.
    // Necesario pues un envio puede ser opcional en la epoca 1, pero si no se despacha, en l epoca 3 se vuelve must-go.
    // Se usa al inicio de cada epoca, antes de usar DHGS.
    // O cuando un envio pendiente reaparece en una nueva epoca.
    // Este esta raro.
    public void actualizarMustGo(LocalDateTime momento, long margenHoras){
        Duration restante = getTiempoRestante(momento);
        this.esMustGo = !restante.isNegative() && restante.toHours() < margenHoras;
    }

    // Calcula un nivel de prioridad numerico basandose en varios factores
    // Cuando se construye soluciones iniciales o sedecide que enviar primero, se requiere de un criterio de ordenamiento.
    // Los mas prioritarios se atienden primero.
    // Esta pendiente calibrar esto matematicamente, pero por ahora como demo va bien.
    public int calcularPrioridad(LocalDateTime momento){
        Duration restante = getTiempoRestante(momento);
        long horasRestantes = Math.max(0, restante.toHours());
        int factorUrgencia = (int) Math.max(0, 100 - horasRestantes);
        int factorMustGo = esMustGo ? 1000 : 0;
        int factorMaletas = Math.max(0, cantidadMaletas) * 10;
        int factorDistancia = 0;

        if (aeropuertoOrigen != null && aeropuertoDestino != null) {
            factorDistancia = (int) (aeropuertoOrigen.getDistanciaA(aeropuertoDestino) / 100.0);
        }

        this.prioridad = factorMustGo + factorUrgencia + factorMaletas + factorDistancia;
        return this.prioridad;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Envio envio)) {
            return false;
        }
        return Objects.equals(id, envio.id)
                && Objects.equals(codigoIcao(aeropuertoOrigen), codigoIcao(envio.aeropuertoOrigen))
                && Objects.equals(codigoIcao(aeropuertoDestino), codigoIcao(envio.aeropuertoDestino))
                && Objects.equals(fechaHoraCreacion, envio.fechaHoraCreacion);
    }

    @Override
    public int hashCode() {
        return Objects.hash(id, codigoIcao(aeropuertoOrigen), codigoIcao(aeropuertoDestino), fechaHoraCreacion);

    }

    private String codigoIcao(Aeropuerto aeropuerto) {
        return aeropuerto != null ? aeropuerto.getCodigoICAO() : null;
    }



}
