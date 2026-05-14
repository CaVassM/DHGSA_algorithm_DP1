package com.tasfb2b.backend.mapper;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;

import java.time.Duration;

public final class DomainMapper {

    private DomainMapper() {}

    public static AirportEntity airportToEntity(Aeropuerto src) {
        return AirportEntity.builder()
                .idNegocio(src.getId())
                .codigoIcao(src.getCodigoICAO())
                .ciudad(src.getCiudad())
                .pais(src.getPais())
                .continente(src.getContinente())
                .capacidadAlmacen(src.getCapacidadAlmacen())
                .latitud(src.getLatitud())
                .longitud(src.getLongitud())
                .gmt(src.getGmt())
                .build();
    }

    public static void updateAirportEntity(AirportEntity target, Aeropuerto src) {
        target.setIdNegocio(src.getId());
        target.setCiudad(src.getCiudad());
        target.setPais(src.getPais());
        target.setContinente(src.getContinente());
        target.setCapacidadAlmacen(src.getCapacidadAlmacen());
        target.setLatitud(src.getLatitud());
        target.setLongitud(src.getLongitud());
        target.setGmt(src.getGmt());
    }

    public static Aeropuerto airportToDomain(AirportEntity src) {
        Aeropuerto a = new Aeropuerto();
        a.setId(src.getIdNegocio() != null ? src.getIdNegocio() : 0);
        a.setCodigoICAO(src.getCodigoIcao());
        a.setCiudad(src.getCiudad());
        a.setPais(src.getPais());
        a.setContinente(src.getContinente());
        a.setCapacidadAlmacen(src.getCapacidadAlmacen());
        a.setLatitud(src.getLatitud());
        a.setLongitud(src.getLongitud());
        a.setGmt(src.getGmt());
        return a;
    }

    public static FlightEntity flightToEntity(Vuelo src, AirportEntity origen, AirportEntity destino) {
        long minutos = src.getDuracion() != null
                ? src.getDuracion().toMinutes()
                : src.getTiempoVuelo();
        return FlightEntity.builder()
                .businessId(src.getId())
                .aeropuertoOrigen(origen)
                .aeropuertoDestino(destino)
                .horaSalida(src.getHoraSalida())
                .horaLlegada(src.getHoraLlegada())
                .capacidad(src.getCapacidad())
                .capacidadDisponible(src.getCapacidadDisponible() > 0
                        ? src.getCapacidadDisponible()
                        : src.getCapacidad())
                .distancia(src.getDistancia())
                .duracionMinutos(minutos)
                .build();
    }

    public static void updateFlightEntity(FlightEntity target, Vuelo src,
                                          AirportEntity origen, AirportEntity destino) {
        target.setAeropuertoOrigen(origen);
        target.setAeropuertoDestino(destino);
        target.setHoraSalida(src.getHoraSalida());
        target.setHoraLlegada(src.getHoraLlegada());
        target.setCapacidad(src.getCapacidad());
        target.setCapacidadDisponible(src.getCapacidadDisponible() > 0
                ? src.getCapacidadDisponible()
                : src.getCapacidad());
        target.setDistancia(src.getDistancia());
        target.setDuracionMinutos(src.getDuracion() != null
                ? src.getDuracion().toMinutes()
                : src.getTiempoVuelo());
    }

    public static Vuelo flightToDomain(FlightEntity src, Aeropuerto origen, Aeropuerto destino) {
        Vuelo v = new Vuelo();
        v.setId(src.getBusinessId());
        v.setAeropuertoOrigen(origen);
        v.setAeropuertoDestino(destino);
        v.setHoraSalida(src.getHoraSalida());
        v.setHoraLlegada(src.getHoraLlegada());
        v.setCapacidad(src.getCapacidad());
        v.setCapacidadDisponible(src.getCapacidadDisponible() != null
                ? src.getCapacidadDisponible()
                : src.getCapacidad());
        v.setDistancia(src.getDistancia());
        v.setDuracion(Duration.ofMinutes(src.getDuracionMinutos() != null ? src.getDuracionMinutos() : 0));
        return v;
    }

    public static ShipmentEntity shipmentToEntity(Envio src, AirportEntity origen, AirportEntity destino) {
        return ShipmentEntity.builder()
                .businessId(src.getId())
                .aeropuertoOrigen(origen)
                .aeropuertoDestino(destino)
                .fechaHoraCreacion(src.getFechaHoraCreacion())
                .cantidadMaletas(src.getCantidadMaletas())
                .idCliente(src.getIdCliente())
                .deadline(src.getDeadline() != null ? src.getDeadline() : src.calcularDeadline())
                .esMustGo(src.isEsMustGo())
                .prioridad(src.getPrioridad())
                .build();
    }

    public static Envio shipmentToDomain(ShipmentEntity src, Aeropuerto origen, Aeropuerto destino) {
        Envio e = new Envio();
        e.setId(src.getBusinessId());
        e.setAeropuertoOrigen(origen);
        e.setAeropuertoDestino(destino);
        e.setFechaHoraCreacion(src.getFechaHoraCreacion());
        e.setCantidadMaletas(src.getCantidadMaletas());
        e.setIdCliente(src.getIdCliente());
        e.setDeadline(src.getDeadline());
        e.setEsMustGo(src.isEsMustGo());
        e.setPrioridad(src.getPrioridad() != null ? src.getPrioridad() : 0);
        return e;
    }
}
