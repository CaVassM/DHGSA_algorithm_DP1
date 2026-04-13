package com.TasfB2B.DHGS.demo.application.service;

import com.TasfB2B.DHGS.demo.algorithm.dhgs.Individuo;
import com.TasfB2B.DHGS.demo.application.dto.*;
import com.TasfB2B.DHGS.demo.domain.model.*;
import com.TasfB2B.DHGS.demo.domain.service.EpocaData;
import com.TasfB2B.DHGS.demo.domain.service.SimuladorEpocas;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.AeropuertoParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.EnvioParser;
import com.TasfB2B.DHGS.demo.infraestructure.ingestion.VueloParser;
import com.TasfB2B.DHGS.demo.infraestructure.util.ConstructorSolucionesIniciales;
import com.TasfB2B.DHGS.demo.infraestructure.util.GrafoVuelos;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Servicio de aplicación que orquesta todo el flujo de optimización DHGS.
 *
 * Flujo:
 * 1. Parsear datos de entrada (aeropuertos, vuelos, envíos)
 * 2. Construir grafo de vuelos
 * 3. Organizar envíos en épocas
 * 4. Para cada época: generar población inicial → (futuro: ejecutar DHGS) → seleccionar mejor
 * 5. Retornar resumen de resultados
 */
@Service
public class OptimizationService {

    private static final Logger log = LoggerFactory.getLogger(OptimizationService.class);

    private final AeropuertoParser aeropuertoParser;
    private final VueloParser vueloParser;
    private final EnvioParser envioParser;
    private final GrafoVuelos grafoVuelos;
    private final SimuladorEpocas simuladorEpocas;
    private final ConstructorSolucionesIniciales constructorSoluciones;

    public OptimizationService(AeropuertoParser aeropuertoParser,
                               VueloParser vueloParser,
                               EnvioParser envioParser,
                               GrafoVuelos grafoVuelos,
                               SimuladorEpocas simuladorEpocas,
                               ConstructorSolucionesIniciales constructorSoluciones) {
        this.aeropuertoParser = aeropuertoParser;
        this.vueloParser = vueloParser;
        this.envioParser = envioParser;
        this.grafoVuelos = grafoVuelos;
        this.simuladorEpocas = simuladorEpocas;
        this.constructorSoluciones = constructorSoluciones;
    }

    /**
     * Ejecuta la optimización completa.
     */
    public OptimizationResponse ejecutar(OptimizationRequest request) {
        long inicio = System.currentTimeMillis();
        OptimizationResponse response = new OptimizationResponse();

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

            // --- PASO 2: Construir grafo ---
            log.info("=== PASO 2: Construyendo grafo de vuelos ===");
            grafoVuelos.construir(aeropuertos, vuelos);
            log.info("Grafo construido: {}", grafoVuelos);

            // --- PASO 3: Organizar en épocas ---
            log.info("=== PASO 3: Organizando en épocas ===");
            List<EpocaData> epocas = simuladorEpocas.organizarEnEpocas(
                    todosLosEnvios, aeropuertos,
                    null, // Usa la fecha del primer envío
                    request.getDuracionEpocaHoras());

            response.setTotalEpocas(epocas.size());

            // --- PASO 4: Procesar cada época ---
            log.info("=== PASO 4: Procesando {} épocas ===", epocas.size());
            List<Envio> pendientes = new ArrayList<>();
            int totalAsignados = 0;
            int totalNoAsignados = 0;
            int totalMaletas = 0;

            for (EpocaData epoca : epocas) {
                log.info("--- Procesando Época {} ---", epoca.getNumeroEpoca());

                // Preparar época (actualizar must-go, agregar pendientes)
                simuladorEpocas.prepararEpoca(epoca, pendientes);

                List<Envio> enviosEpoca = epoca.getTodosLosEnvios();

                if (enviosEpoca.isEmpty()) {
                    pendientes = new ArrayList<>();
                    continue;
                }

                // Generar población inicial
                // TODO: Aquí se integrará el algoritmo DHGS completo
                List<Individuo> poblacionInicial = constructorSoluciones.generarPoblacionInicial(
                        enviosEpoca, epoca.getNumeroEpoca(),
                        epocas.size(), request.getTamanoPoblacion());

                // Por ahora: seleccionar la mejor solución de la población inicial
                Individuo mejorSolucion = poblacionInicial.stream()
                        .min((a, b) -> Double.compare(a.getFitness(), b.getFitness()))
                        .orElse(null);

                // Finalizar época
                pendientes = simuladorEpocas.finalizarEpoca(epoca, mejorSolucion);

                // Acumular métricas
                if (mejorSolucion != null) {
                    totalAsignados += mejorSolucion.getEnviosAsignados().size();
                    totalNoAsignados += mejorSolucion.getEnviosNoAsignados().size();
                    totalMaletas += mejorSolucion.getEnviosAsignados().keySet().stream()
                            .mapToInt(Envio::getCantidadMaletas).sum();
                }

                // Generar resumen de esta época
                response.getResumenPorEpoca().add(crearResumenEpoca(epoca));
            }

            // --- PASO 5: Componer respuesta ---
            response.setEpocasProcesadas(epocas.size());
            response.setCostoTotal(simuladorEpocas.getCostoAcumulado());
            response.setTotalEnviosAsignados(totalAsignados);
            response.setTotalEnviosNoAsignados(pendientes.size());
            response.setTotalMaletasDespachadas(totalMaletas);
            response.setSimulacionCompleta(pendientes.isEmpty());
            response.setMensaje("Simulación completada exitosamente");

        } catch (Exception e) {
            log.error("Error durante la optimización", e);
            response.setMensaje("Error: " + e.getMessage());
            response.setSimulacionCompleta(false);
        }

        response.setTiempoEjecucionMs(System.currentTimeMillis() - inicio);
        return response;
    }

    /**
     * Obtiene el resumen de una época específica.
     */
    public EpocaResumenDTO obtenerResumenEpoca(int numero) {
        EpocaData epoca = simuladorEpocas.obtenerEpoca(numero);
        if (epoca == null) return null;
        return crearResumenEpoca(epoca);
    }

    /**
     * Obtiene el historial de todas las épocas procesadas.
     */
    public List<EpocaResumenDTO> obtenerHistorial() {
        return simuladorEpocas.getHistorial().stream()
                .map(this::crearResumenEpoca)
                .collect(Collectors.toList());
    }

    // --- Métodos privados ---

    private EpocaResumenDTO crearResumenEpoca(EpocaData epoca) {
        EpocaResumenDTO dto = new EpocaResumenDTO();
        dto.setNumeroEpoca(epoca.getNumeroEpoca());
        dto.setEnviosNuevos(epoca.getEnviosNuevos() != null ? epoca.getEnviosNuevos().size() : 0);
        dto.setEnviosPendientes(epoca.getEnviosPendientes() != null ? epoca.getEnviosPendientes().size() : 0);
        dto.setEnviosDespachados(epoca.getEnviosDespachados() != null ? epoca.getEnviosDespachados().size() : 0);
        dto.setEnviosPostpuestos(epoca.getEnviosPostpuestos() != null ? epoca.getEnviosPostpuestos().size() : 0);
        dto.setMustGo(epoca.contarMustGo());
        dto.setMaletasTotales(epoca.contarMaletasTotales());
        dto.setCostoEpoca(epoca.getCostoEpoca());
        dto.setProcesada(epoca.isProcesada());

        // Ocupación de almacenes
        if (epoca.getEstadoAlmacenes() != null) {
            epoca.getEstadoAlmacenes().forEach((icao, estado) ->
                    dto.getOcupacionAlmacenes().put(icao, estado.getNivelOcupacion() * 100));
        }

        return dto;
    }
}
