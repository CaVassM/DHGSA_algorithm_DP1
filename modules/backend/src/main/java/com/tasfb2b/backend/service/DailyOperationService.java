package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.dto.request.DailyRegisterRequest;
import com.tasfb2b.backend.dto.response.DailyBulkUploadResponse;
import com.tasfb2b.backend.dto.response.DailyCancelResponse;
import com.tasfb2b.backend.dto.response.DailyCloseReportResponse;
import com.tasfb2b.backend.dto.response.DailyRegisterResponse;
import com.tasfb2b.backend.dto.response.DailyShipmentRouteResponse;
import com.tasfb2b.backend.dto.response.DailyStateResponse;
import com.tasfb2b.backend.mapper.DomainMapper;
import com.tasfb2b.backend.repository.AirportRepository;
import com.tasfb2b.backend.repository.FlightRepository;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.InstanciaVuelo;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.domain.valueobject.HoraLocal;
import com.tasfb2b.dhgs.demo.domain.valueobject.TiemposOperacion;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
     * Asignaciones vigentes: qué vuelos concretos lleva cada envío aceptado.
     *
     * <p>El historial de {@code atendidos} guarda la ruta como identificadores,
     * que sirven para el reporte pero no para reasignar: al cancelar un vuelo hay
     * que devolver capacidad a los tramos que sí operan y buscar ruta nueva, y
     * para eso hacen falta los objetos vivos del grafo.
     */
    private final Map<String, AsignacionViva> asignaciones = new LinkedHashMap<>();

    /** Envío aceptado con la ruta que ocupa en este momento. */
    private record AsignacionViva(Envio envio, List<Vuelo> ruta) {
    }

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
            // Se materializan las salidas de hoy y mañana en vez de dejar las
            // plantillas sueltas. Hacen falta dos días por dos razones: el plazo
            // de entrega llega a 2 días, así que una ruta puede necesitar un
            // vuelo de mañana; y una cancelación pedida a última hora recae sobre
            // la salida del día siguiente (P&R P9), que tiene que existir para
            // poder marcarse.
            //
            // El día se toma en UTC porque es la referencia común: con terminales
            // en cuatro husos no hay un "hoy" único, y las salidas de los vuelos
            // ya viven en esa misma línea de tiempo.
            LocalDate hoy = HoraLocal.ahoraUtc().toLocalDate();
            nuevoGrafo.construir(new ArrayList<>(aeropuertosByIcao.values()), vuelos, hoy, 2);

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
            this.asignaciones.clear();
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

            // Busca una ruta de vuelos que admita TODA la carga (carga requerida
            // = maletas). La salida más temprana admisible es AHORA: sin acotarlo,
            // la búsqueda arranca al principio del día y puede devolver vuelos que
            // ya despegaron — maletas asignadas a aviones que no están.
            List<Vuelo> ruta = grafo.dijkstraMenorTiempo(
                    origen, destino, maletas, HoraLocal.ahoraUtc());
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

            // Huso horario: la recepción se registra en la hora de pared del
            // aeropuerto que la recibe. Cuatro terminales registrando a la vez
            // desde Lima, Buenos Aires, Copenhague y Delhi marcan cuatro horas
            // distintas para el mismo instante; guardar la del servidor las
            // volvería todas iguales y el plazo se contaría desde una hora que
            // en ese mostrador nunca ocurrió.
            //
            // Se conserva la hora local (lo que ve el operador) y el instante
            // absoluto (lo que permite comparar y ordenar entre husos).
            LocalDateTime horaLocal = resolverHoraLocal(request.getFechaHoraLocal(), origen);
            LocalDateTime creacionUtc = HoraLocal.aUtc(horaLocal, origen);

            String envioId = "DIA-" + secuenciaEnvio.incrementAndGet();
            Envio envio = new Envio();
            envio.setId(envioId);
            envio.setAeropuertoOrigen(origen);
            envio.setAeropuertoDestino(destino);
            envio.setFechaHoraCreacion(creacionUtc);
            envio.setCantidadMaletas(maletas);
            envio.setIdCliente(request.getIdCliente());
            LocalDateTime deadline = envio.calcularDeadline();
            // El plazo se muestra en la hora del aeropuerto de DESTINO: es donde
            // hay que entregar la maleta y donde alguien la va a esperar.
            LocalDateTime deadlineLocalDestino = HoraLocal.aLocal(deadline, destino);

            // P&R P16: cuándo queda entregada la maleta, no solo hasta cuándo hay
            // plazo. Es la llegada del último vuelo más el recojo en destino.
            LocalDateTime entregaUtc = calcularEntrega(ruta);
            LocalDateTime entregaLocalDestino = HoraLocal.aLocal(entregaUtc, destino);
            Long holguraMinutos = (entregaUtc != null && deadline != null)
                    ? Duration.between(entregaUtc, deadline).toMinutes()
                    : null;

            totalAceptados++;
            totalMaletasDespachadas += maletas;

            List<String> rutaIds = ruta.stream().map(Vuelo::getId).toList();

            // Ruta vigente del envío: es lo que permite reasignarlo si más tarde
            // se cancela uno de sus vuelos.
            asignaciones.put(envioId, new AsignacionViva(envio, new ArrayList<>(ruta)));

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
                    .registradoLocal(horaLocal)
                    .deadlineLocalDestino(deadlineLocalDestino)
                    .entregaLocalDestino(entregaLocalDestino)
                    .holguraMinutos(holguraMinutos)
                    .gmtOrigen(HoraLocal.etiquetaGmt(origen))
                    .gmtDestino(HoraLocal.etiquetaGmt(destino))
                    .rutaVuelos(rutaIds)
                    .directa(ruta.size() == 1)
                    .escalas(ruta.size() - 1)
                    .build();
        } finally {
            lock.unlock();
        }
    }

    /**
     * Envíos registrados con su ruta, para dibujarlos en el mapa.
     *
     * <p>Se sirven desde las asignaciones vivas y no desde el historial, de modo
     * que un envío reasignado tras una cancelación aparezca con la ruta que
     * realmente sigue y no con la que se anuló.
     */
    @Transactional(readOnly = true)
    public List<DailyShipmentRouteResponse> enviosConRuta() {
        lock.lock();
        try {
            asegurarInicializado();

            List<DailyShipmentRouteResponse> resultado = new ArrayList<>();
            for (Map.Entry<String, AsignacionViva> e : asignaciones.entrySet()) {
                Envio envio = e.getValue().envio();
                List<Vuelo> ruta = e.getValue().ruta();
                Aeropuerto origen = envio.getAeropuertoOrigen();
                Aeropuerto destino = envio.getAeropuertoDestino();

                List<DailyShipmentRouteResponse.Tramo> tramos = new ArrayList<>();
                LocalDateTime llegadaPrevia = null;

                for (Vuelo v : ruta) {
                    if (!(v instanceof InstanciaVuelo inst)) continue;
                    Aeropuerto o = v.getAeropuertoOrigen();
                    Aeropuerto d = v.getAeropuertoDestino();
                    LocalDateTime salida = inst.getFechaHoraSalida();
                    LocalDateTime llegada = inst.getFechaHoraLlegada();

                    tramos.add(DailyShipmentRouteResponse.Tramo.builder()
                            .vueloId(v.getId())
                            .origenIcao(o.getCodigoICAO())
                            .destinoIcao(d.getCodigoICAO())
                            .salidaUtc(salida)
                            .llegadaUtc(llegada)
                            .salidaLocal(HoraLocal.aLocal(salida, o))
                            .llegadaLocal(HoraLocal.aLocal(llegada, d))
                            .gmtOrigen(HoraLocal.etiquetaGmt(o))
                            .gmtDestino(HoraLocal.etiquetaGmt(d))
                            .esperaMinutos(llegadaPrevia != null && salida != null
                                    ? Duration.between(llegadaPrevia, salida).toMinutes()
                                    : 0)
                            .cancelado(!inst.estaOperable())
                            .build());
                    llegadaPrevia = llegada;
                }

                LocalDateTime entregaUtc = calcularEntrega(ruta);
                resultado.add(DailyShipmentRouteResponse.builder()
                        .envioId(e.getKey())
                        .origenIcao(origen.getCodigoICAO())
                        .destinoIcao(destino.getCodigoICAO())
                        .cantidadMaletas(envio.getCantidadMaletas())
                        .idCliente(envio.getIdCliente())
                        .registradoLocal(HoraLocal.aLocal(envio.getFechaHoraCreacion(), origen))
                        .entregaLocalDestino(HoraLocal.aLocal(entregaUtc, destino))
                        .deadlineLocalDestino(HoraLocal.aLocal(envio.getDeadline(), destino))
                        .gmtOrigen(HoraLocal.etiquetaGmt(origen))
                        .gmtDestino(HoraLocal.etiquetaGmt(destino))
                        .directa(tramos.size() == 1)
                        .escalas(Math.max(0, tramos.size() - 1))
                        .tramos(tramos)
                        .build());
            }
            return resultado;
        } finally {
            lock.unlock();
        }
    }

    /**
     * Carga en lote de envíos desde un archivo de texto.
     *
     * <p>Cada línea pasa por el mismo registro que usa el operador, así que la
     * carga masiva y el tecleo manual no pueden divergir: se valida la ruta, se
     * descuenta la capacidad y se aplica el huso horario igual en ambos casos.
     *
     * <p>Formato por línea, el de la data histórica:
     * {@code id-AAAAMMDD-HH-mm-DESTINO-maletas-cliente}. La fecha y hora se leen
     * como <b>hora local del aeropuerto de origen</b>, que es como las anota el
     * mostrador que las recibió.
     *
     * @param origenIcao aeropuerto de la terminal que sube el archivo
     * @param contenido  texto completo del archivo
     */
    public DailyBulkUploadResponse cargarLote(String origenIcao, String contenido) {
        List<DailyRegisterResponse> resultados = new ArrayList<>();
        List<String> errores = new ArrayList<>();
        int lineaNum = 0;

        for (String linea : contenido.split("\\R")) {
            lineaNum++;
            String limpia = linea.trim();
            if (limpia.isEmpty() || limpia.startsWith("#")) {
                continue;
            }

            String[] p = limpia.split("-");
            if (p.length < 7) {
                errores.add("Línea " + lineaNum + ": se esperan 7 campos separados por '-', llegaron "
                        + p.length + " ('" + limpia + "').");
                continue;
            }

            try {
                String fecha = p[1].trim();               // AAAAMMDD
                LocalDateTime horaLocal = LocalDateTime.of(
                        Integer.parseInt(fecha.substring(0, 4)),
                        Integer.parseInt(fecha.substring(4, 6)),
                        Integer.parseInt(fecha.substring(6, 8)),
                        Integer.parseInt(p[2].trim()),    // HH
                        Integer.parseInt(p[3].trim()));   // mm

                DailyRegisterRequest req = new DailyRegisterRequest();
                req.setOrigenIcao(origenIcao);
                req.setDestinoIcao(p[4].trim());
                req.setCantidadMaletas(Integer.parseInt(p[5].trim()));
                req.setIdCliente(p[6].trim());
                req.setFechaHoraLocal(horaLocal.toString());

                resultados.add(registrar(req));
            } catch (RuntimeException e) {
                errores.add("Línea " + lineaNum + ": no se pudo leer ('" + limpia + "').");
            }
        }

        long aceptados = resultados.stream().filter(DailyRegisterResponse::isAceptado).count();
        log.info("Día a día: carga en lote desde {} — {} aceptados, {} rechazados, {} ilegibles.",
                origenIcao, aceptados, resultados.size() - aceptados, errores.size());

        return DailyBulkUploadResponse.builder()
                .origenIcao(origenIcao)
                .lineasProcesadas(resultados.size())
                .aceptados((int) aceptados)
                .rechazados((int) (resultados.size() - aceptados))
                .errores(errores)
                .registros(resultados)
                .build();
    }

    /**
     * Cancela un vuelo y reasigna sus maletas (P&R P9).
     *
     * <p>A diferencia de la simulación por épocas, aquí no hay una siguiente
     * ronda de planificación donde recolocar la carga: la operación es continua y
     * el operador necesita saber en el acto si las maletas tienen otro vuelo. Por
     * eso la reasignación es inmediata — se busca ruta nueva para cada envío
     * afectado y se responde con lo que se pudo recolocar y lo que no.
     *
     * <p>Un envío que no encuentra ruta alternativa NO se descarta en silencio:
     * queda listado como sin reasignar, que es la información que el operador
     * necesita para actuar.
     */
    @Transactional(readOnly = true)
    public DailyCancelResponse cancelarVuelo(String idVuelo) {
        lock.lock();
        try {
            asegurarInicializado();

            if (cierre != null) {
                return DailyCancelResponse.builder()
                        .aplicada(false)
                        .idVuelo(idVuelo)
                        .mensaje("La jornada está cerrada. Reinicia la operación para cancelar vuelos.")
                        .build();
            }

            InstanciaVuelo instancia = grafo.resolverInstanciaACancelar(idVuelo, HoraLocal.ahoraUtc());
            if (instancia == null) {
                return DailyCancelResponse.builder()
                        .aplicada(false)
                        .idVuelo(idVuelo)
                        .mensaje("No hay ninguna salida de " + idVuelo + " que pueda cancelarse:"
                                + " o el vuelo no existe, o sus salidas restantes están dentro de"
                                + " la hora previa (o ya canceladas).")
                        .build();
            }

            instancia.setCancelado(true);

            // Envíos que viajaban en esa salida. Se copian las claves porque el
            // bucle reasigna y modifica el mapa mientras lo recorre.
            List<String> afectados = asignaciones.entrySet().stream()
                    .filter(e -> e.getValue().ruta().contains(instancia))
                    .map(Map.Entry::getKey)
                    .toList();

            List<DailyCancelResponse.EnvioReasignado> reasignados = new ArrayList<>();
            List<DailyCancelResponse.EnvioReasignado> sinRuta = new ArrayList<>();
            int maletasAfectadas = 0;

            for (String envioId : afectados) {
                AsignacionViva previa = asignaciones.get(envioId);
                Envio envio = previa.envio();
                int maletas = envio.getCantidadMaletas();
                maletasAfectadas += maletas;

                // Libera la ruta rota completa: los tramos sanos ya no transportan
                // esta carga, y sin devolverla quedarían ocupados por maletas que
                // nunca van a viajar en ellos — la ruta nueva los encontraría
                // llenos sin motivo. Al vuelo cancelado no se le devuelve nada:
                // no opera.
                for (Vuelo tramo : previa.ruta()) {
                    if (tramo != instancia) {
                        tramo.liberarCapacidad(maletas);
                    }
                }
                asignaciones.remove(envioId);

                List<Vuelo> nueva = grafo.dijkstraMenorTiempo(
                        envio.getAeropuertoOrigen(), envio.getAeropuertoDestino(), maletas,
                        HoraLocal.ahoraUtc());

                if (nueva == null || nueva.isEmpty()) {
                    sinRuta.add(DailyCancelResponse.EnvioReasignado.builder()
                            .envioId(envioId)
                            .origenIcao(envio.getAeropuertoOrigen().getCodigoICAO())
                            .destinoIcao(envio.getAeropuertoDestino().getCodigoICAO())
                            .cantidadMaletas(maletas)
                            .rutaAnterior(previa.ruta().stream().map(Vuelo::getId).toList())
                            .rutaNueva(List.of())
                            .build());
                    continue;
                }

                for (Vuelo tramo : nueva) {
                    tramo.registrarAsignacion(maletas);
                }
                asignaciones.put(envioId, new AsignacionViva(envio, new ArrayList<>(nueva)));

                List<String> idsNueva = nueva.stream().map(Vuelo::getId).toList();
                reasignados.add(DailyCancelResponse.EnvioReasignado.builder()
                        .envioId(envioId)
                        .origenIcao(envio.getAeropuertoOrigen().getCodigoICAO())
                        .destinoIcao(envio.getAeropuertoDestino().getCodigoICAO())
                        .cantidadMaletas(maletas)
                        .rutaAnterior(previa.ruta().stream().map(Vuelo::getId).toList())
                        .rutaNueva(idsNueva)
                        .build());

                // El reporte de cierre debe reflejar la ruta que finalmente lleva
                // el envío, no la que se canceló.
                atendidos.stream()
                        .filter(a -> envioId.equals(a.getEnvioId()))
                        .findFirst()
                        .ifPresent(a -> {
                            a.setRutaVuelos(idsNueva);
                            a.setDirecta(idsNueva.size() == 1);
                            a.setEscalas(idsNueva.size() - 1);
                        });
            }

            log.info("Día a día: cancelado {} del {} ({} envíos afectados, {} reasignados, {} sin ruta).",
                    idVuelo, instancia.getFechaOperacion(), afectados.size(),
                    reasignados.size(), sinRuta.size());

            String resumen = afectados.isEmpty()
                    ? String.format("Vuelo %s del %s cancelado. No transportaba maletas.",
                            idVuelo, instancia.getFechaOperacion())
                    : String.format("Vuelo %s del %s cancelado. %d de %d envío(s) reasignados a otros vuelos%s.",
                            idVuelo, instancia.getFechaOperacion(), reasignados.size(), afectados.size(),
                            sinRuta.isEmpty() ? "" : ", " + sinRuta.size() + " sin ruta alternativa");

            return DailyCancelResponse.builder()
                    .aplicada(true)
                    .idVuelo(idVuelo)
                    .idInstancia(instancia.getId())
                    .fechaOperacion(instancia.getFechaOperacion())
                    .horaSalida(instancia.getHoraSalida())
                    .origenIcao(instancia.getAeropuertoOrigen().getCodigoICAO())
                    .destinoIcao(instancia.getAeropuertoDestino().getCodigoICAO())
                    .enviosAfectados(afectados.size())
                    .maletasAfectadas(maletasAfectadas)
                    .enviosReasignados(reasignados)
                    .enviosSinRuta(sinRuta)
                    .mensaje(resumen)
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

    /**
     * Momento en que la maleta queda entregada al cliente (P&R P16).
     *
     * <p>Llegada del último vuelo de la ruta más el tiempo de recojo en destino.
     * Se devuelve en UTC; quien la muestre la convierte al huso que corresponda.
     */
    private LocalDateTime calcularEntrega(List<Vuelo> ruta) {
        if (ruta == null || ruta.isEmpty()) {
            return null;
        }
        Vuelo ultimo = ruta.get(ruta.size() - 1);
        if (!(ultimo instanceof InstanciaVuelo instancia)
                || instancia.getFechaHoraLlegada() == null) {
            return null;
        }
        return instancia.getFechaHoraLlegada().plus(TiemposOperacion.RECOJO_DESTINO);
    }

    /**
     * Hora de pared con la que se registra la recepción.
     *
     * <p>La manda la terminal, que durante la prueba tiene el reloj puesto en el
     * huso de su ciudad. Si no llega (carga de archivo sin hora, o una llamada
     * directa a la API), se deduce del reloj del servidor convertido al huso del
     * aeropuerto: el resultado es el mismo instante, expresado como lo vería el
     * operador de ese mostrador.
     */
    private LocalDateTime resolverHoraLocal(String fechaHoraLocal, Aeropuerto origen) {
        if (fechaHoraLocal != null && !fechaHoraLocal.isBlank()) {
            try {
                return LocalDateTime.parse(fechaHoraLocal.trim());
            } catch (DateTimeParseException e) {
                log.warn("Hora local inválida ('{}'), se usa el reloj del servidor en {}.",
                        fechaHoraLocal, origen.getCodigoICAO());
            }
        }
        return HoraLocal.ahoraEn(origen);
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
