package com.TasfB2B.DHGS.demo.domain.model;

import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

// Esto tambien para obtener el estado del almacen en un momento.
// No usar setter de enviosPendientes, solo agregar o remover, para mantener la integridad de maletasActuales.
@Getter
@Setter
public class AlmacenEstado {
    // El almacen y su aeropuerto respectivo.
    // Cada almacen cuenta con envios pendientes
    private Aeropuerto aeropuerto;
    private LocalDateTime momentoTiempo; //??
    private int maletasActuales = 0;
    private List<Envio> enviosPendientes;

    // Ahora los metodos
    // Esto para obtener nivel por medio de porcentaje
    public double getNivelOcupacion(){
        if (aeropuerto == null || aeropuerto.getCapacidadAlmacen() <= 0) {
            return 0;
        }
        return (double) maletasActuales / aeropuerto.getCapacidadAlmacen();

    }

    public void agregarEnvio(Envio envio){
        if (envio == null) {
            return;
        }
        if (enviosPendientes == null) {
            enviosPendientes = new ArrayList<>();
        }
        enviosPendientes.add(envio);
        maletasActuales += Math.max(0, envio.getCantidadMaletas());

    }

    public void removerEnvio(Envio envio){
        if (envio == null || enviosPendientes == null) {
            return;
        }
        boolean removido = enviosPendientes.remove(envio);
        if (removido) {
            maletasActuales = Math.max(0, maletasActuales - Math.max(0, envio.getCantidadMaletas()));
        }

    }

}
