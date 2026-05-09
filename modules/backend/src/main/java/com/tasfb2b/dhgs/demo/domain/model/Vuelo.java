package com.tasfb2b.dhgs.demo.domain.model;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Duration;
import java.time.LocalTime;
import java.util.Objects;


// Representa un vuelo programado entre dos aeropuertos. Es un arco en el grafo de transporte, una arista.
// Vuelos cuentan con horarios fijos y capacidad limitada.
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class Vuelo {

    private String id; // Se genera automaticamente? no
    private Aeropuerto aeropuertoOrigen;
    private Aeropuerto aeropuertoDestino;
    private LocalTime horaSalida;
    private LocalTime horaLlegada;
    private int capacidad; // CRITICO para no sobrecargar vuelo
    private int capacidadDisponible; // Capacidad residual considerando asignaciones previas
    private double distancia; // Kilometros calculado con Haversine
    private Duration duracion; // Tiempo de vuelo calculado

    // Verifica si este vuelo conecta directamente dos aeropuertos especificos
    // Uasdo cuando se busca como enviar maletas de A a B. Se pregunta si es que hay vuelso directos.
    // Si es que si, es la opcion mas rapida, si es que no, se buscan rutas con escalas.
    public boolean esDirecto(Aeropuerto origen, Aeropuerto destino){
        return this.aeropuertoOrigen.getCodigoICAO().equals(origen.getCodigoICAO())
                && this.aeropuertoDestino.getCodigoICAO().equals(destino.getCodigoICAO());
    }

    // Retorna la duracion del vuelo en minutos
    public long getTiempoVuelo(){
        this.duracion = Duration.between(this.horaSalida, this.horaLlegada);
        // Pasa cuando el vuelo cruza la medianoche.
        // Por ejemplo, un vuelo parte a las 23:30pm y llega a la 1:15am.
        if (this.duracion.isNegative()) {
            this.duracion = this.duracion.plusHours(24);
        }
        return this.duracion.toMinutes();
    }

    public void setCapacidad(int capacidad) {
        this.capacidad = capacidad;
        if (this.capacidadDisponible <= 0 || this.capacidadDisponible > capacidad) {
            this.capacidadDisponible = Math.max(0, capacidad);
        }
    }

    public boolean estaOperable() {
        return true;
    }

    public boolean estaDisponiblePara(int cantidadMaletas) {
        return cantidadMaletas >= 0
                && capacidadDisponible >= cantidadMaletas;
    }


    public boolean registrarAsignacion(int cantidadMaletas) {
        if (!estaDisponiblePara(cantidadMaletas)) {
            return false;
        }
        this.capacidadDisponible -= cantidadMaletas;
        return true;
    }

    public void liberarCapacidad(int cantidadMaletas) {
        if (cantidadMaletas <= 0) {
            return;
        }
        this.capacidadDisponible = Math.min(capacidad, capacidadDisponible + cantidadMaletas);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Vuelo vuelo)) {
            return false;
        }
        return Objects.equals(aeropuertoOrigen, vuelo.aeropuertoOrigen)
                && Objects.equals(aeropuertoDestino, vuelo.aeropuertoDestino)
                && Objects.equals(horaSalida, vuelo.horaSalida);
    }

    @Override
    public int hashCode() {
        return Objects.hash(aeropuertoOrigen, aeropuertoDestino, horaSalida);
    }

}
