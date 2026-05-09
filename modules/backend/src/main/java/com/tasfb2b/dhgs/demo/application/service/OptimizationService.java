package com.tasfb2b.dhgs.demo.application.service;

import com.tasfb2b.dhgs.demo.application.dto.EpocaResumenDTO;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Servicio de aplicación que orquesta el flujo completo de optimización.
 *
 * Flujo:
 * 1. Parsear datos de entrada (aeropuertos, vuelos, envíos)
 * 2. Construir grafo de vuelos del horizonte operativo
 * 3. Organizar envíos en épocas
 * 4. Para cada época: ejecutar la metaheurística seleccionada sobre el mismo dominio
 * 5. Retornar resumen de resultados
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

    /**
     * Ejecuta la optimización completa.
     */
    public OptimizationResponse ejecutar(OptimizationRequest request) {
        long inicio = System.currentTimeMillis();
        OptimizationAlgorithm algoritmoSeleccionado = request.getAlgoritmo() != null
            ? request.getAlgoritmo()
            : OptimizationAlgorithm.DHGS;
        OptimizationResponse response = OptimizationResponse.started(algoritmoSeleccionado);

        try {
            // --- PASO 1: Parsear datos ---
            log.info("=== PASO 1: Parseando datos de entrada ===");

            List<Aeropuerto> aeropuertos = aeropuertoParser.parsear(
                    Paths.get(request.getArchivoAeropuertos()));

            Map<String, Aeropuerto> mapaAeropuertos = aeropuertos.stream()
                    .collect(Collectors.toMap(Aeropuerto::getCodigoICAO, a -> a));

            List<Vuelo> vuelos = vueloParser.parsear(
                    Paths.get(request.getArchivoVuelos()), mapaAeropuertos);

            List<Envio> todosLosEnvios = new ArrayList<>();
            for (String archivoEnvio : request.getArchivosEnvios()) {
                List<Envio> enviosArchivo = envioParser.parsear(
                        Paths.get(archivoEnvio), mapaAeropuertos);
                todosLosEnvios.addAll(enviosArchivo);
            }

            log.info("Datos cargados: {} aeropuertos, {} vuelos, {} envíos",
                    aeropuertos.size(), vuelos.size(), todosLosEnvios.size());

            // --- PASO 2: Organizar en épocas ---
            log.info("=== PASO 2: Organizando en épocas ===");
            List<EpocaData> epocas = simuladorEpocas.organizarEnEpocas(
                    todosLosEnvios, aeropuertos,
                    request.getFechaInicioSimulacion(),
                    request.getDuracionEpocaHoras(),
                    request.getDuracionSimulacionDias());

            response.markTotalEpocas(epocas.size());

            LocalDate inicioHorizonte = !epocas.isEmpty()
                    ? epocas.get(0).getInicio().toLocalDate()
                    : (request.getFechaInicioSimulacion() != null
                        ? request.getFechaInicioSimulacion().toLocalDate()
                        : todosLosEnvios.stream()
                            .map(Envio::getFechaHoraCreacion)
                            .min(java.time.LocalDateTime::compareTo)
                            .orElseThrow()
                            .toLocalDate()
                            .minusDays(1));

            // --- PASO 3: Construir grafo del horizonte ---
            log.info("=== PASO 3: Construyendo grafo de vuelos recurrentes ===");
            grafoVuelos.construir(
                    aeropuertos,
                    vuelos,
                    inicioHorizonte,
                    Math.max(1, request.getDuracionSimulacionDias()));
            log.info("Grafo construido: {}", grafoVuelos);

                DHGSAlgorithm dhgs = algoritmoSeleccionado == OptimizationAlgorithm.DHGS
                    ? new DHGSAlgorithm(constructorSoluciones, split, calculadorFitness, validador)
                    : null;
                IALNSAlgorithm ialns = algoritmoSeleccionado == OptimizationAlgorithm.IALNS
                    ? new IALNSAlgorithm(constructorSoluciones, split, calculadorFitness, validador)
                    : null;

            // --- PASO 4: Procesar cada época ---
            log.info("=== PASO 4: Procesando {} épocas ===", epocas.size());
            List<Envio> pendientes = new ArrayList<>();
            int totalAsignados = 0;
            int totalMaletas = 0;
            Map<String, RutaDTO> rutasCalculadas = new LinkedHashMap<>();

            for (EpocaData epoca : epocas) {
                log.info("--- Procesando Época {} ---", epoca.getNumeroEpoca());

                // Preparar época (actualizar must-go, agregar pendientes)
                simuladorEpocas.prepararEpoca(epoca, pendientes);

                List<Envio> enviosEpoca = epoca.getTodosLosEnvios();

                if (enviosEpoca.isEmpty()) {
                    pendientes = new ArrayList<>();
                    continue;
                }

                Individuo mejorSolucion = algoritmoSeleccionado == OptimizationAlgorithm.IALNS
                    ? ialns.ejecutar(
                        enviosEpoca,
                        epoca.getNumeroEpoca(),
                        epocas.size(),
                        request.getTamanoPoblacion(),
                        Duration.ofSeconds(Math.max(1, request.getLimiteTiempoSegundos())))
                    : dhgs.ejecutar(
                        enviosEpoca,
                        epoca.getNumeroEpoca(),
                        epocas.size(),
                        request.getTamanoPoblacion(),
                        Duration.ofSeconds(Math.max(1, request.getLimiteTiempoSegundos())));

                // Finalizar época
                pendientes = simuladorEpocas.finalizarEpoca(epoca, mejorSolucion);

                // Acumular métricas
                if (mejorSolucion != null) {
                    totalAsignados += mejorSolucion.getEnviosAsignados().size();
                    totalMaletas += mejorSolucion.getEnviosAsignados().keySet().stream()
                            .mapToInt(Envio::getCantidadMaletas).sum();
                    mejorSolucion.getEnviosAsignados().forEach((envio, ruta) ->
                            rutasCalculadas.put(claveRuta(envio), crearRutaDto(envio, ruta)));
                }

                // Generar resumen de esta época
                response.addResumenEpoca(EpocaResumenDTO.from(epoca));
            }

            // --- PASO 5: Componer respuesta ---
            response.complete(
                    epocas.size(),
                    simuladorEpocas.getCostoAcumulado(),
                    totalAsignados,
                    pendientes.size(),
                    totalMaletas,
                    pendientes.isEmpty(),
                    new ArrayList<>(rutasCalculadas.values()),
                    "Simulación completada exitosamente con " + algoritmoSeleccionado
            );

        } catch (Exception e) {
            log.error("Error durante la optimización", e);
            response.markError("Error: " + e.getMessage());
        }

        response.finish(System.currentTimeMillis() - inicio);
        return response;
    }

    /**
     * Obtiene el resumen de una época específica.
     */
    public EpocaResumenDTO obtenerResumenEpoca(int numero) {
        EpocaData epoca = simuladorEpocas.obtenerEpoca(numero);
        if (epoca == null) return null;
        return EpocaResumenDTO.from(epoca);
    }

    /**
     * Obtiene el historial de todas las épocas procesadas.
     */
    public List<EpocaResumenDTO> obtenerHistorial() {
        return simuladorEpocas.getHistorial().stream()
                .map(EpocaResumenDTO::from)
                .collect(Collectors.toList());
    }

    // --- Métodos privados ---
    private RutaDTO crearRutaDto(Envio envio, RutaEnvio ruta) {
        return RutaDTO.from(envio, ruta);
    }

    private String claveRuta(Envio envio) {
        return envio.getId() + "|"
                + (envio.getAeropuertoOrigen() != null ? envio.getAeropuertoOrigen().getCodigoICAO() : "N/A") + "|"
                + (envio.getAeropuertoDestino() != null ? envio.getAeropuertoDestino().getCodigoICAO() : "N/A");
    }
}
