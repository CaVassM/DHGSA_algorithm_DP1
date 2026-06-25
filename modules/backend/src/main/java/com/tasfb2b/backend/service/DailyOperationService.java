package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.dto.request.DailyRegisterRequest;
import com.tasfb2b.backend.dto.response.DailyRegisterResponse;
import com.tasfb2b.backend.dto.response.DailyStateResponse;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Operación día a día (escenario REAL_TIME).
 *
 * Los envíos se registran a mano, uno a uno. NO se corre el optimizador y NO
 * se devuelve la ruta "óptima": basta con que exista una ruta de vuelos con
 * capacidad. Cada registro descuenta esa capacidad en vivo, de modo que las
 * capacidades se van llenando en línea hasta el colapso (cuando ya no entra
 * carga en ninguna ruta).
 *
 * El estado es en memoria y vive mientras el backend esté arriba. Se reconstruye
 * con {@link #reiniciar()} (recarga el grafo desde BD y limpia capacidades).
 */
@Service
@RequiredArgsConstructor
public class DailyOperationService {

    private static final Logger log = LoggerFactory.getLogger(DailyOperationService.class);

    private final AirportRepository airportRepository;
    private final FlightRepository flightRepository;

    /** Grafo con capacidades vivas; se descuentan conforme se registran envíos. */
    private GrafoVuelos grafo;
    private boolean inicializado = false;

    private final AtomicInteger secuenciaEnvio = new AtomicInteger(0);
    private int totalRegistrados = 0;
    private int totalAceptados = 0;
    private int totalRechazados = 0;
    private int totalMaletasDespachadas = 0;

    /** Serializa registro/reinicio: el estado en memoria es mutable y compartido. */
    private final ReentrantLock lock = new ReentrantLock();

    /**
     * (Re)construye el estado: carga aeropuertos y vuelos desde la BD con sus
     * capacidades a tope y borra el historial de registros.
     */
    @Transactional(readOnly = true)
    public void reiniciar() {
        lock.lock();
        try {
            List<AirportEntity> airportEntities = airportRepository.findAll();
            if (airportEntities.isEmpty()) {
                throw new IllegalStateException(
                        "No hay aeropuertos en la BD. Importa datos antes de usar la operación día a día.");
            }

            Map<String, Aeropuerto> aeropuertosByIcao = new HashMap<>();
            for (AirportEntity e : airportEntities) {
                aeropuertosByIcao.put(e.getCodigoIcao(), DomainMapper.airportToDomain(e));
            }

            List<Vuelo> vuelos = new ArrayList<>();
            for (FlightEntity f : flightRepository.findAll()) {
                Aeropuerto origen = aeropuertosByIcao.get(f.getAeropuertoOrigen().getCodigoIcao());
                Aeropuerto destino = aeropuertosByIcao.get(f.getAeropuertoDestino().getCodigoIcao());
                if (origen == null || destino == null) continue;
                Vuelo v = DomainMapper.flightToDomain(f, origen, destino);
                // Capacidad a tope: en el día a día partimos de cero ocupación.
                v.setCapacidadDisponible(v.getCapacidad());
                vuelos.add(v);
            }

            GrafoVuelos nuevoGrafo = new GrafoVuelos();
            nuevoGrafo.construir(new ArrayList<>(aeropuertosByIcao.values()), vuelos);

            this.grafo = nuevoGrafo;
            this.inicializado = true;
            this.secuenciaEnvio.set(0);
            this.totalRegistrados = 0;
            this.totalAceptados = 0;
            this.totalRechazados = 0;
            this.totalMaletasDespachadas = 0;

            log.info("Operación día a día reiniciada: {} aeropuertos, {} vuelos.",
                    aeropuertosByIcao.size(), vuelos.size());
        } finally {
            lock.unlock();
        }
    }

    /**
     * Registra un envío manual. Valida que exista ruta con capacidad para toda
     * la cantidad de maletas; si la hay, la descuenta en vivo y acepta. Si no,
     * rechaza con el motivo (sin vuelo / capacidad saturada = indicio de colapso).
     */
    @Transactional(readOnly = true)
    public DailyRegisterResponse registrar(DailyRegisterRequest request) {
        lock.lock();
        try {
            asegurarInicializado();
            totalRegistrados++;

            String origenIcao = request.getOrigenIcao().trim().toUpperCase();
            String destinoIcao = request.getDestinoIcao().trim().toUpperCase();
            int maletas = request.getCantidadMaletas();

            Aeropuerto origen = grafo.getAeropuertos().get(origenIcao);
            Aeropuerto destino = grafo.getAeropuertos().get(destinoIcao);

            if (origen == null) {
                return rechazo("No existe el aeropuerto de origen: " + origenIcao,
                        origenIcao, destinoIcao, maletas);
            }
            if (destino == null) {
                return rechazo("No existe el aeropuerto de destino: " + destinoIcao,
                        origenIcao, destinoIcao, maletas);
            }
            if (origenIcao.equals(destinoIcao)) {
                return rechazo("El origen y el destino no pueden ser el mismo aeropuerto.",
                        origenIcao, destinoIcao, maletas);
            }

            // Busca una ruta de vuelos que admita TODA la carga (carga requerida = maletas).
            List<Vuelo> ruta = grafo.dijkstraMenorTiempo(origen, destino, maletas);
            if (ruta == null || ruta.isEmpty()) {
                return rechazo("No hay ruta con capacidad para " + maletas
                                + " maletas de " + origenIcao + " a " + destinoIcao
                                + " (sin vuelo disponible o capacidad saturada).",
                        origenIcao, destinoIcao, maletas);
            }

            // Descuenta la capacidad en cada vuelo de la ruta (en vivo).
            for (Vuelo vuelo : ruta) {
                boolean ok = vuelo.registrarAsignacion(maletas);
                if (!ok) {
                    // No debería pasar porque Dijkstra ya filtró por capacidad,
                    // pero si pasa revertimos para no dejar capacidad inconsistente.
                    revertir(ruta, vuelo, maletas);
                    return rechazo("Capacidad insuficiente en el vuelo " + vuelo.getId()
                                    + " al confirmar la ruta.",
                            origenIcao, destinoIcao, maletas);
                }
            }

            String envioId = "DIA-" + secuenciaEnvio.incrementAndGet();
            Envio envio = new Envio();
            envio.setId(envioId);
            envio.setAeropuertoOrigen(origen);
            envio.setAeropuertoDestino(destino);
            envio.setFechaHoraCreacion(LocalDateTime.now());
            envio.setCantidadMaletas(maletas);
            envio.setIdCliente(request.getIdCliente());
            LocalDateTime deadline = envio.calcularDeadline();

            totalAceptados++;
            totalMaletasDespachadas += maletas;

            List<String> rutaIds = ruta.stream().map(Vuelo::getId).toList();
            log.info("Día a día: aceptado {} ({} maletas, {} -> {}, {} vuelos).",
                    envioId, maletas, origenIcao, destinoIcao, ruta.size());

            return DailyRegisterResponse.builder()
                    .aceptado(true)
                    .mensaje("Envío registrado y capacidad descontada.")
                    .envioId(envioId)
                    .origenIcao(origenIcao)
                    .destinoIcao(destinoIcao)
                    .cantidadMaletas(maletas)
                    .deadline(deadline)
                    .rutaVuelos(rutaIds)
                    .directa(ruta.size() == 1)
                    .escalas(ruta.size() - 1)
                    .build();
        } finally {
            lock.unlock();
        }
    }

    /** Estado actual de capacidades de la flota (para visualizar el colapso). */
    @Transactional(readOnly = true)
    public DailyStateResponse estado() {
        lock.lock();
        try {
            asegurarInicializado();

            List<DailyStateResponse.FlightLoad> cargas = new ArrayList<>();
            long capacidadTotal = 0;
            long ocupadoTotal = 0;
            boolean algunoConCupo = false;

            for (List<Vuelo> salientes : grafo.getAdyacencia().values()) {
                for (Vuelo v : salientes) {
                    int ocupado = v.getCapacidad() - v.getCapacidadDisponible();
                    double pct = v.getCapacidad() > 0
                            ? (ocupado * 100.0) / v.getCapacidad()
                            : 0.0;
                    capacidadTotal += v.getCapacidad();
                    ocupadoTotal += ocupado;
                    if (v.getCapacidadDisponible() > 0) {
                        algunoConCupo = true;
                    }
                    cargas.add(DailyStateResponse.FlightLoad.builder()
                            .vueloId(v.getId())
                            .origenIcao(v.getAeropuertoOrigen().getCodigoICAO())
                            .destinoIcao(v.getAeropuertoDestino().getCodigoICAO())
                            .capacidad(v.getCapacidad())
                            .capacidadDisponible(v.getCapacidadDisponible())
                            .ocupado(ocupado)
                            .ocupacionPorcentaje(redondear(pct))
                            .build());
                }
            }

            cargas.sort(Comparator.comparingDouble(
                    DailyStateResponse.FlightLoad::getOcupacionPorcentaje).reversed());

            double ocupacionFlota = capacidadTotal > 0
                    ? (ocupadoTotal * 100.0) / capacidadTotal
                    : 0.0;

            return DailyStateResponse.builder()
                    .totalRegistrados(totalRegistrados)
                    .totalAceptados(totalAceptados)
                    .totalRechazados(totalRechazados)
                    .totalMaletasDespachadas(totalMaletasDespachadas)
                    .ocupacionFlotaPorcentaje(redondear(ocupacionFlota))
                    .colapsoTotal(!algunoConCupo && !cargas.isEmpty())
                    .vuelos(cargas)
                    .build();
        } finally {
            lock.unlock();
        }
    }

    // --- privados ---

    private void asegurarInicializado() {
        if (!inicializado || grafo == null) {
            reiniciar();
        }
    }

    private DailyRegisterResponse rechazo(String motivo, String origen, String destino, int maletas) {
        totalRechazados++;
        log.info("Día a día: rechazado ({} -> {}, {} maletas): {}", origen, destino, maletas, motivo);
        return DailyRegisterResponse.builder()
                .aceptado(false)
                .mensaje(motivo)
                .origenIcao(origen)
                .destinoIcao(destino)
                .cantidadMaletas(maletas)
                .build();
    }

    /** Devuelve la capacidad ya descontada en los vuelos previos al que falló. */
    private void revertir(List<Vuelo> ruta, Vuelo donde, int maletas) {
        for (Vuelo v : ruta) {
            if (v == donde) break;
            v.liberarCapacidad(maletas);
        }
    }

    private static double redondear(double valor) {
        return Math.round(valor * 100.0) / 100.0;
    }
}
