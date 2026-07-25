package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.dto.request.DailyRegisterRequest;
import com.tasfb2b.backend.dto.response.DailyCloseReportResponse;
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

    /**
     * G09: historial de la jornada. Antes solo se llevaban contadores, así que
     * al cerrar no había con qué armar un reporte: se sabía cuántos envíos se
     * aceptaron, pero no cuáles ni por dónde iban. Se guardan aquí para poder
     * congelar la foto final de la operación.
     */
    private final List<DailyCloseReportResponse.EnvioCerrado> atendidos = new ArrayList<>();
    private final List<DailyCloseReportResponse.EnvioRechazado> rechazados = new ArrayList<>();

    /** Momento del primer registro de la jornada (null mientras no haya ninguno). */
    private LocalDateTime inicioOperacion;

    /**
     * G09: reporte congelado de la última jornada cerrada. Mientras exista, la
     * operación está cerrada y no admite nuevos registros (hay que reiniciar).
     * Se conserva para poder volver a consultarlo e imprimirlo.
     */
    private DailyCloseReportResponse cierre;

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
            // G09: abrir una jornada nueva descarta el historial y el cierre previo.
            this.atendidos.clear();
            this.rechazados.clear();
            this.inicioOperacion = null;
            this.cierre = null;

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

            // G09: con la jornada cerrada el reporte ya está congelado; aceptar
            // más envíos lo dejaría desactualizado sin aviso.
            if (cierre != null) {
                return DailyRegisterResponse.builder()
                        .aceptado(false)
                        .mensaje("La jornada está cerrada. Reinicia la operación para registrar nuevos envíos.")
                        .origenIcao(request.getOrigenIcao())
                        .destinoIcao(request.getDestinoIcao())
                        .cantidadMaletas(request.getCantidadMaletas())
                        .build();
            }

            totalRegistrados++;
            if (inicioOperacion == null) {
                inicioOperacion = LocalDateTime.now();
            }

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

            // G09: queda en el historial para poder listarlo en el reporte de cierre.
            atendidos.add(DailyCloseReportResponse.EnvioCerrado.builder()
                    .envioId(envioId)
                    .origenIcao(origenIcao)
                    .destinoIcao(destinoIcao)
                    .cantidadMaletas(maletas)
                    .idCliente(request.getIdCliente())
                    .registradoEn(envio.getFechaHoraCreacion())
                    .deadline(deadline)
                    .rutaVuelos(rutaIds)
                    .directa(ruta.size() == 1)
                    .escalas(ruta.size() - 1)
                    .build());

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
            return estadoInterno();
        } finally {
            lock.unlock();
        }
    }

    /**
     * Cálculo del estado sin tomar el lock ni inicializar: lo usan {@link #estado()}
     * y {@link #cerrar()}, que ya lo hicieron. Separado para que el cierre pueda
     * reutilizar exactamente la misma foto de la flota que ve la pantalla.
     */
    private DailyStateResponse estadoInterno() {
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
    }

    /**
     * G09: cierra la jornada y devuelve el reporte de la última planificación
     * estable. Congela la foto: totales, cumplimiento, estado final de la flota
     * y el detalle de lo atendido y lo rechazado.
     *
     * <p>Es idempotente: si ya se cerró, devuelve el mismo reporte en vez de
     * generar uno nuevo (así dos visualizadores que cierren a la vez ven lo
     * mismo). Para volver a operar hay que llamar a {@link #reiniciar()}.
     */
    @Transactional(readOnly = true)
    public DailyCloseReportResponse cerrar() {
        lock.lock();
        try {
            asegurarInicializado();
            if (cierre != null) {
                return cierre;
            }

            DailyStateResponse estadoFinal = estadoInterno();

            int vuelosSaturados = (int) estadoFinal.getVuelos().stream()
                    .filter(v -> v.getCapacidadDisponible() <= 0)
                    .count();

            double atencion = totalRegistrados > 0
                    ? (totalAceptados * 100.0) / totalRegistrados
                    : 0.0;

            // Los 10 vuelos más cargados: dónde se concentró la presión del día.
            List<DailyStateResponse.FlightLoad> masCargados = estadoFinal.getVuelos().stream()
                    .limit(10)
                    .toList();

            cierre = DailyCloseReportResponse.builder()
                    .fechaCierre(LocalDateTime.now())
                    .inicioOperacion(inicioOperacion)
                    .totalRegistrados(totalRegistrados)
                    .totalAceptados(totalAceptados)
                    .totalRechazados(totalRechazados)
                    .totalMaletasDespachadas(totalMaletasDespachadas)
                    .porcentajeAtencion(redondear(atencion))
                    .ocupacionFlotaPorcentaje(estadoFinal.getOcupacionFlotaPorcentaje())
                    .colapsoTotal(estadoFinal.isColapsoTotal())
                    .vuelosOperados(estadoFinal.getVuelos().size())
                    .vuelosSaturados(vuelosSaturados)
                    .motivo(describirCierre(estadoFinal.isColapsoTotal(), atencion))
                    .enviosAtendidos(List.copyOf(atendidos))
                    .enviosRechazados(List.copyOf(rechazados))
                    .vuelosMasCargados(masCargados)
                    .build();

            log.info("Día a día: jornada cerrada. {} registrados, {} atendidos ({}%), {} rechazados.",
                    totalRegistrados, totalAceptados, redondear(atencion), totalRechazados);

            return cierre;
        } finally {
            lock.unlock();
        }
    }

    /**
     * G09: último reporte de cierre, o {@code null} si la jornada sigue abierta.
     * Permite que otro visualizador consulte el reporte sin volver a cerrarla.
     */
    public DailyCloseReportResponse ultimoCierre() {
        lock.lock();
        try {
            return cierre;
        } finally {
            lock.unlock();
        }
    }

    // --- privados ---

    private String describirCierre(boolean colapso, double atencion) {
        if (colapso) {
            return "Jornada cerrada en COLAPSO: ningún vuelo admitía más carga al momento del cierre.";
        }
        if (totalRegistrados == 0) {
            return "Jornada cerrada sin registros.";
        }
        if (totalRechazados == 0) {
            return "Jornada cerrada con normalidad: todos los envíos registrados encontraron ruta con capacidad.";
        }
        if (atencion >= 95.0) {
            return "Jornada cerrada con normalidad, con rechazos puntuales por falta de cupo.";
        }
        if (atencion >= 85.0) {
            return "Jornada cerrada con presión sobre la capacidad: una parte de los envíos no encontró ruta.";
        }
        if (atencion >= 50.0) {
            return "Jornada cerrada con capacidad insuficiente: una parte importante de los envíos"
                    + " no pudo ser atendida.";
        }
        return "Jornada cerrada con capacidad desbordada: la mayoría de los envíos no pudo ser atendida.";
    }

    private void asegurarInicializado() {
        if (!inicializado || grafo == null) {
            reiniciar();
        }
    }

    private DailyRegisterResponse rechazo(String motivo, String origen, String destino, int maletas) {
        totalRechazados++;
        // G09: los rechazos también entran al reporte — son la evidencia de dónde
        // se quedó corta la capacidad al cerrar la jornada.
        rechazados.add(DailyCloseReportResponse.EnvioRechazado.builder()
                .origenIcao(origen)
                .destinoIcao(destino)
                .cantidadMaletas(maletas)
                .registradoEn(LocalDateTime.now())
                .motivo(motivo)
                .build());
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
