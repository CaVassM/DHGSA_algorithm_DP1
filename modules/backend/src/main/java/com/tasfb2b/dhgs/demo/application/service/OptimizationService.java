package com.tasfb2b.dhgs.demo.application.service;

import com.tasfb2b.dhgs.demo.application.dto.EpocaResumenDTO;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationOutcome;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationRequest;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationResponse;
import com.tasfb2b.dhgs.demo.application.dto.RutaDTO;
import com.tasfb2b.dhgs.demo.algorithm.dhgs.DHGSAlgorithm;
import com.tasfb2b.dhgs.demo.algorithm.dhgs.Individuo;
import com.tasfb2b.dhgs.demo.algorithm.ialns.IALNSAlgorithm;
import com.tasfb2b.dhgs.demo.domain.model.Aeropuerto;
import com.tasfb2b.dhgs.demo.domain.model.Envio;
import com.tasfb2b.dhgs.demo.domain.model.RutaEnvio;
import com.tasfb2b.dhgs.demo.domain.model.Vuelo;
import com.tasfb2b.dhgs.demo.domain.service.EpocaData;
import com.tasfb2b.dhgs.demo.domain.service.SimuladorEpocas;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.AeropuertoParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.EnvioParser;
import com.tasfb2b.dhgs.demo.infraestructure.ingestion.VueloParser;
import com.tasfb2b.dhgs.demo.infraestructure.util.AlgoritmoSPLIT;
import com.tasfb2b.dhgs.demo.infraestructure.util.CalculadorFitness;
import com.tasfb2b.dhgs.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.tasfb2b.dhgs.demo.infraestructure.util.GrafoVuelos;
import com.tasfb2b.dhgs.demo.infraestructure.util.Validador;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Paths;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Servicio de aplicación que orquesta el flujo completo de optimización.
 *
 * Existen dos entradas:
 *  - {@link #ejecutar(OptimizationRequest)}: flujo file-based original (parsea .txt).
 *  - {@link #ejecutarSobreDatos}: flujo data-based para fuentes ya cargadas (BD).
 *
 * Ambas convergen en {@link #procesar} y exponen el outcome enriquecido con las
 * referencias de dominio necesarias para persistir cada ruta.
 */
@Service
@RequiredArgsConstructor
public class OptimizationService {

    private static final Logger log = LoggerFactory.getLogger(OptimizationService.class);

    private final AeropuertoParser aeropuertoParser;
    private final VueloParser vueloParser;
    private final EnvioParser envioParser;
    private final GrafoVuelos grafoVuelos;
    private final SimuladorEpocas simuladorEpocas;
    private final ConstructorSolucionesIniciales constructorSoluciones;
    private final AlgoritmoSPLIT split;
    private final CalculadorFitness calculadorFitness;
    private final Validador validador;

    /** Entrada file-based original. Mantiene la firma para compatibilidad. */
    public OptimizationResponse ejecutar(OptimizationRequest request) {
        return ejecutarConOutcome(request).response();
    }

    /** Variante file-based que expone el outcome completo (para persistencia). */
    public OptimizationOutcome ejecutarConOutcome(OptimizationRequest request) {
        long inicio = System.currentTimeMillis();
        OptimizationAlgorithm algoritmo = request.getAlgoritmo() != null
                ? request.getAlgoritmo() : OptimizationAlgorithm.DHGS;
        OptimizationResponse response = OptimizationResponse.started(algoritmo);

        try {
            log.info("=== PASO 1: Parseando datos de entrada ===");
            List<Aeropuerto> aeropuertos = aeropuertoParser.parsear(Paths.get(request.getArchivoAeropuertos()));
            Map<String, Aeropuerto> mapaAeropuertos = aeropuertos.stream()
                    .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));
            List<Vuelo> vuelos = vueloParser.parsear(Paths.get(request.getArchivoVuelos()), mapaAeropuertos);
            List<Envio> envios = new ArrayList<>();
            for (String archivoEnvio : request.getArchivosEnvios()) {
                envios.addAll(envioParser.parsear(Paths.get(archivoEnvio), mapaAeropuertos));
            }
            log.info("Datos cargados: {} aeropuertos, {} vuelos, {} envíos",
                    aeropuertos.size(), vuelos.size(), envios.size());

            ExecutionParams params = new ExecutionParams(
                    algoritmo,
                    request.getFechaInicioSimulacion(),
                    request.getDuracionEpocaHoras(),
                    request.getDuracionSimulacionDias(),
                    request.getTamanoPoblacion(),
                    request.getLimiteTiempoSegundos()
            );
            return procesar(aeropuertos, vuelos, envios, params, response, inicio);
        } catch (Exception e) {
            log.error("Error durante la optimización (file-based)", e);
            response.markError("Error: " + e.getMessage());
            response.finish(System.currentTimeMillis() - inicio);
            return new OptimizationOutcome(response, Map.of(), Map.of());
        }
    }

    /** Entrada data-based para datos pre-cargados (típicamente desde la BD). */
private OptimizationOutcome procesar(List<Aeropuerto> aeropuertos,
                                     List<Vuelo> vuelos,
                                     List<Envio> envios,
                                     ExecutionParams params,
                                     OptimizationResponse response,
                                     long inicio) {
    OptimizationAlgorithm algoritmo = params.algoritmo() != null
            ? params.algoritmo() : OptimizationAlgorithm.DHGS;

    log.info("=== PASO 2: Organizando en épocas ===");
    List<EpocaData> epocas = simuladorEpocas.organizarEnEpocas(
            envios, aeropuertos,
            params.fechaInicioSimulacion(),
            params.duracionEpocaHoras(),
            params.duracionSimulacionDias()
    );

    response.markTotalEpocas(epocas.size());

    LocalDate inicioHorizonte = !epocas.isEmpty()
            ? epocas.get(0).getInicio().toLocalDate()
            : (params.fechaInicioSimulacion() != null
                ? params.fechaInicioSimulacion().toLocalDate()
                : envios.stream()
                    .map(Envio::getFechaHoraCreacion)
                    .min(LocalDateTime::compareTo)
                    .orElseThrow()
                    .toLocalDate()
                    .minusDays(1));

    log.info("=== PASO 3: Construyendo grafo de vuelos recurrentes ===");
    grafoVuelos.construir(
            aeropuertos,
            vuelos,
            inicioHorizonte,
            Math.max(1, params.duracionSimulacionDias())
    );

    log.info("Grafo construido: {}", grafoVuelos);

    DHGSAlgorithm dhgs = algoritmo == OptimizationAlgorithm.DHGS
            ? new DHGSAlgorithm(constructorSoluciones, split, calculadorFitness, validador)
            : null;

    IALNSAlgorithm ialns = algoritmo == OptimizationAlgorithm.IALNS
            ? new IALNSAlgorithm(constructorSoluciones, split, calculadorFitness, validador)
            : null;

    log.info("=== PASO 4: Procesando {} épocas ===", epocas.size());

    List<Envio> pendientes = new ArrayList<>();
    int totalAsignados = 0;
    int totalMaletas = 0;

    Map<Long, RutaDTO> rutasDTO = new LinkedHashMap<>();
    Map<Long, RutaEnvio> rutasDominio = new LinkedHashMap<>();
    Map<Long, Envio> enviosPorId = new HashMap<>();

    for (EpocaData epoca : epocas) {
        log.info("--- Procesando Época {} ---", epoca.getNumeroEpoca());

        simuladorEpocas.prepararEpoca(epoca, pendientes);

        List<Envio> enviosEpoca = epoca.getTodosLosEnvios();

        if (enviosEpoca.isEmpty()) {
            pendientes = new ArrayList<>();
            continue;
        }

        Individuo mejor = algoritmo == OptimizationAlgorithm.IALNS
                ? ialns.ejecutar(
                    enviosEpoca,
                    epoca.getNumeroEpoca(),
                    epocas.size(),
                    params.tamanoPoblacion(),
                    Duration.ofSeconds(Math.max(1, params.limiteTiempoSegundos()))
                )
                : dhgs.ejecutar(
                    enviosEpoca,
                    epoca.getNumeroEpoca(),
                    epocas.size(),
                    params.tamanoPoblacion(),
                    Duration.ofSeconds(Math.max(1, params.limiteTiempoSegundos()))
                );

        pendientes = simuladorEpocas.finalizarEpoca(epoca, mejor);

        if (mejor != null) {
            totalAsignados += mejor.getEnviosAsignados().size();

            totalMaletas += mejor.getEnviosAsignados().keySet().stream()
                    .mapToInt(Envio::getCantidadMaletas)
                    .sum();

            mejor.getEnviosAsignados().forEach((envio, ruta) -> {
                if (envio.getDbId() == null) {
                    log.warn(
                            "No se registra ruta: Envio sin dbId. businessId={}, origen={}",
                            envio.getId(),
                            envio.getAeropuertoOrigen() != null
                                    ? envio.getAeropuertoOrigen().getCodigoICAO()
                                    : null
                    );
                    return;
                }

                rutasDTO.put(envio.getDbId(), RutaDTO.from(envio, ruta));
                rutasDominio.put(envio.getDbId(), ruta);
                enviosPorId.put(envio.getDbId(), envio);
            });
        }

        response.addResumenEpoca(EpocaResumenDTO.from(epoca));
    }

    response.complete(
            epocas.size(),
            simuladorEpocas.getCostoAcumulado(),
            totalAsignados,
            pendientes.size(),
            totalMaletas,
            pendientes.isEmpty(),
            new ArrayList<>(rutasDTO.values()),
            "Simulación completada exitosamente con " + algoritmo
    );

    response.finish(System.currentTimeMillis() - inicio);

    return new OptimizationOutcome(response, rutasDominio, enviosPorId);
}
    public OptimizationOutcome ejecutarSobreDatos(List<Aeropuerto> aeropuertos,
                                                  List<Vuelo> vuelos,
                                                  List<Envio> envios,
                                                  ExecutionParams params) {
        long inicio = System.currentTimeMillis();
        OptimizationAlgorithm algoritmo = params.algoritmo() != null
                ? params.algoritmo() : OptimizationAlgorithm.DHGS;
        OptimizationResponse response = OptimizationResponse.started(algoritmo);
        try {
            return procesar(aeropuertos, vuelos, envios, params, response, inicio);
        } catch (Exception e) {
            log.error("Error durante la optimización (data-based)", e);
            response.markError("Error: " + e.getMessage());
            response.finish(System.currentTimeMillis() - inicio);
            return new OptimizationOutcome(response, Map.of(), Map.of());
        }
    }
//
//    private OptimizationOutcome procesar(List<Aeropuerto> aeropuertos,
//                                         List<Vuelo> vuelos,
//                                         List<Envio> envios,
//                                         ExecutionParams params,
//                                         OptimizationResponse response,
//                                         long inicio) {
//        OptimizationAlgorithm algoritmo = params.algoritmo() != null
//                ? params.algoritmo() : OptimizationAlgorithm.DHGS;
//
//        log.info("=== PASO 2: Organizando en épocas ===");
//        List<EpocaData> epocas = simuladorEpocas.organizarEnEpocas(
//                envios, aeropuertos,
//                params.fechaInicioSimulacion(),
//                params.duracionEpocaHoras(),
//                params.duracionSimulacionDias());
//        response.markTotalEpocas(epocas.size());
//
//        LocalDate inicioHorizonte = !epocas.isEmpty()
//                ? epocas.get(0).getInicio().toLocalDate()
//                : (params.fechaInicioSimulacion() != null
//                    ? params.fechaInicioSimulacion().toLocalDate()
//                    : envios.stream()
//                        .map(Envio::getFechaHoraCreacion)
//                        .min(LocalDateTime::compareTo)
//                        .orElseThrow()
//                        .toLocalDate()
//                        .minusDays(1));
//
//        log.info("=== PASO 3: Construyendo grafo de vuelos recurrentes ===");
//        grafoVuelos.construir(aeropuertos, vuelos, inicioHorizonte,
//                Math.max(1, params.duracionSimulacionDias()));
//        log.info("Grafo construido: {}", grafoVuelos);
//
//        DHGSAlgorithm dhgs = algoritmo == OptimizationAlgorithm.DHGS
//                ? new DHGSAlgorithm(constructorSoluciones, split, calculadorFitness, validador) : null;
//        IALNSAlgorithm ialns = algoritmo == OptimizationAlgorithm.IALNS
//                ? new IALNSAlgorithm(constructorSoluciones, split, calculadorFitness, validador) : null;
//
//        log.info("=== PASO 4: Procesando {} épocas ===", epocas.size());
//        List<Envio> pendientes = new ArrayList<>();
//        int totalAsignados = 0;
//        int totalMaletas = 0;
//        Map<String, RutaDTO> rutasDTO = new LinkedHashMap<>();
//        Map<String, RutaEnvio> rutasDominio = new LinkedHashMap<>();
//        Map<String, Envio> enviosPorId = new HashMap<>();
//
//        for (EpocaData epoca : epocas) {
//            log.info("--- Procesando Época {} ---", epoca.getNumeroEpoca());
//            simuladorEpocas.prepararEpoca(epoca, pendientes);
//            List<Envio> enviosEpoca = epoca.getTodosLosEnvios();
//            if (enviosEpoca.isEmpty()) {
//                pendientes = new ArrayList<>();
//                continue;
//            }
//
//            Individuo mejor = algoritmo == OptimizationAlgorithm.IALNS
//                    ? ialns.ejecutar(enviosEpoca, epoca.getNumeroEpoca(), epocas.size(),
//                        params.tamanoPoblacion(),
//                        Duration.ofSeconds(Math.max(1, params.limiteTiempoSegundos())))
//                    : dhgs.ejecutar(enviosEpoca, epoca.getNumeroEpoca(), epocas.size(),
//                        params.tamanoPoblacion(),
//                        Duration.ofSeconds(Math.max(1, params.limiteTiempoSegundos())));
//
//            pendientes = simuladorEpocas.finalizarEpoca(epoca, mejor);
//
//            if (mejor != null) {
//                totalAsignados += mejor.getEnviosAsignados().size();
//                totalMaletas += mejor.getEnviosAsignados().keySet().stream()
//                        .mapToInt(Envio::getCantidadMaletas).sum();
//                mejor.getEnviosAsignados().forEach((envio, ruta) -> {
//                    rutasDTO.put(envio.getId(), RutaDTO.from(envio, ruta));
//                    rutasDominio.put(envio.getId(), ruta);
//                    enviosPorId.put(envio.getId(), envio);
//                });
//            }
//            response.addResumenEpoca(EpocaResumenDTO.from(epoca));
//        }
//
//        response.complete(
//                epocas.size(),
//                simuladorEpocas.getCostoAcumulado(),
//                totalAsignados,
//                pendientes.size(),
//                totalMaletas,
//                pendientes.isEmpty(),
//                new ArrayList<>(rutasDTO.values()),
//                "Simulación completada exitosamente con " + algoritmo
//        );
//        response.finish(System.currentTimeMillis() - inicio);
//        return new OptimizationOutcome(response, rutasDominio, enviosPorId);
//    }

    public EpocaResumenDTO obtenerResumenEpoca(int numero) {
        EpocaData epoca = simuladorEpocas.obtenerEpoca(numero);
        if (epoca == null) return null;
        return EpocaResumenDTO.from(epoca);
    }

    public List<EpocaResumenDTO> obtenerHistorial() {
        return simuladorEpocas.getHistorial().stream()
                .map(EpocaResumenDTO::from)
                .collect(Collectors.toList());
    }

    /** Parámetros de ejecución desacoplados del medio de entrada (file/db). */
    public record ExecutionParams(
            OptimizationAlgorithm algoritmo,
            LocalDateTime fechaInicioSimulacion,
            long duracionEpocaHoras,
            long duracionSimulacionDias,
            int tamanoPoblacion,
            int limiteTiempoSegundos
    ) {}
}
