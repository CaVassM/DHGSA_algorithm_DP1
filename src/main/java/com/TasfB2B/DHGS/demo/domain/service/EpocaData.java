package com.TasfB2B.DHGS.demo.domain.service;

import com.TasfB2B.DHGS.demo.domain.model.AlmacenEstado;
import com.TasfB2B.DHGS.demo.domain.model.Envio;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Representa los datos de una época de simulación.
 * Una época es un intervalo de tiempo (ej: 4 horas) durante el cual
 * el algoritmo DHGS procesa envíos.
 */
@Getter
@Setter
public class EpocaData {

    private int numeroEpoca;
    private LocalDateTime inicio;
    private LocalDateTime fin;
    private List<Envio> enviosNuevos;          // Envíos que llegan en esta época
    private List<Envio> enviosPendientes;      // Envíos de épocas anteriores sin despachar
    private List<Envio> enviosDespachados;     // Envíos despachados al final de la época
    private List<Envio> enviosPostpuestos;     // Envíos que pasan a la siguiente época
    private Map<String, AlmacenEstado> estadoAlmacenes; // ICAO → estado
    private double costoEpoca;                 // Costo total de la solución de esta época
    private boolean procesada;                 // Va a indicar si fue pasado o no la data.

    public EpocaData() {
        this.enviosNuevos = new ArrayList<>();
        this.enviosPendientes = new ArrayList<>();
        this.enviosDespachados = new ArrayList<>();
        this.enviosPostpuestos = new ArrayList<>();
        this.estadoAlmacenes = new HashMap<>();
        this.costoEpoca = 0.0;
        this.procesada = false;
    }

    public EpocaData(int numeroEpoca, LocalDateTime inicio, LocalDateTime fin) {
        this(); // Se construye
        this.numeroEpoca = numeroEpoca;
        this.inicio = inicio;
        this.fin = fin;
    }

    /**
     * Retorna todos los envíos disponibles para esta época (nuevos + pendientes).
     */
    public List<Envio> getTodosLosEnvios() {
        List<Envio> todos = new ArrayList<>();
        if (enviosNuevos != null) todos.addAll(enviosNuevos);
        if (enviosPendientes != null) todos.addAll(enviosPendientes);
        return todos;
    }

    /**
     * Cuenta los envíos must-go en esta época.
     */
    public long contarMustGo() {
        return getTodosLosEnvios().stream()
                .filter(Envio::isEsMustGo)
                .count();
    }

    /**
     * Cuenta el total de maletas en esta época.
     */
    public int contarMaletasTotales() {
        return getTodosLosEnvios().stream()
                .mapToInt(Envio::getCantidadMaletas)
                .sum();
    }

    @Override
    public String toString() {
        return String.format("Epoca[%d] %s → %s | nuevos=%d, pendientes=%d, mustGo=%d, maletas=%d",
                numeroEpoca, inicio, fin,
                enviosNuevos != null ? enviosNuevos.size() : 0,
                enviosPendientes != null ? enviosPendientes.size() : 0,
                contarMustGo(),
                contarMaletasTotales());
    }
}

