package com.tasfb2b.dhgs.demo.domain.model;

import lombok.Getter;
import lombok.Setter;

import java.util.Objects;

// 1 Aeropuerto consta de 1 almacen, solo 1 ojo.
// Est ees un nodo en el grafo de transporte.
@Getter
@Setter
public class Aeropuerto {
    /* Recordemos algunas cosas
    - Private siempre que podemos acceder solo de la misma clase, otro objeto no puede
     */
    private int id;
    private String codigoICAO;
    private String ciudad;
    private String pais;
    private String continente; // America/Europa/Asia (asignado)
    private int capacidadAlmacen; // Numero de maletas por almacenar, CRITICO
    private double latitud; // Coordenada geografica en decimal
    private double longitud; // coordenada geogrfica en decimal
    private int gmt; // Zona horaria

    // Calcula la distancia en kilómetros entre este aeropuerto y otro usando la fórmula de Haversine
    public double getDistanciaA(Aeropuerto aeropuertoDestino){
        double radioTierra = 6371; // Radio de la Tierra en kilómetros

        double latitudOrigenRad = Math.toRadians(this.latitud);
        double latitudDestinoRad = Math.toRadians(aeropuertoDestino.latitud);
        double diferenciaLatitudRad = Math.toRadians(aeropuertoDestino.latitud - this.latitud);
        double diferenciaLongitudRad = Math.toRadians(aeropuertoDestino.longitud - this.longitud);

        double a = Math.sin(diferenciaLatitudRad / 2) * Math.sin(diferenciaLatitudRad / 2) +
                   Math.cos(latitudOrigenRad) * Math.cos(latitudDestinoRad) *
                   Math.sin(diferenciaLongitudRad / 2) * Math.sin(diferenciaLongitudRad / 2);

        double c = 2 * Math.asin(Math.sqrt(a));

        return radioTierra * c;
    }

    // Determina si este aeropuerto y otro están en el mismo continente
    public boolean estaMismoContinente(Aeropuerto aeropuertoDestino){
        return aeropuertoDestino != null
                && this.continente != null
                && this.continente.equals(aeropuertoDestino.continente);
    }

    @Override
    public String toString() {
        return codigoICAO + " - " + ciudad + ", " + pais + " (Capacidad: " + capacidadAlmacen + ")";
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (!(o instanceof Aeropuerto that)) {
            return false;
        }
        return Objects.equals(codigoICAO, that.codigoICAO);
    }

    @Override
    public int hashCode() {
        return Objects.hash(codigoICAO);
    }

}
