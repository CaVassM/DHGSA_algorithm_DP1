package com.tasfb2b.backend.service;

import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationRequest;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationResponse;
import com.tasfb2b.dhgs.demo.application.service.OptimizationService;
import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.dto.response.PlanningResponse;
import org.springframework.beans.factory.annotation.Value;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

@Service
@RequiredArgsConstructor
public class PlanningService {

    private final OptimizationService optimizationService;

    @Value("${planner.defaults.epoch-hours:4}")
    private long defaultEpochHours;

    @Value("${planner.defaults.population-size:6}")
    private int defaultPopulationSize;

    @Value("${planner.defaults.time-limit-seconds:2}")
    private int defaultTimeLimitSeconds;

    @Value("${planner.datasets.demo.aeropuertos:src/test/resources/datos/estudiantes.txt}")
    private String demoAeropuertos;

    @Value("${planner.datasets.demo.vuelos:src/test/resources/datos/planes_vuelo.txt}")
    private String demoVuelos;

    @Value("${planner.datasets.demo.envios-dir:src/test/resources/datos/envios_preliminar_test}")
    private String demoEnviosDir;

    @Value("${planner.datasets.real.aeropuertos:src/test/resources/datos/estudiantes_real.txt}")
    private String realAeropuertos;

    @Value("${planner.datasets.real.vuelos:src/test/resources/datos/planes_vuelo_real.txt}")
    private String realVuelos;

    @Value("${planner.datasets.real.envios-dir:src/test/resources/datos/envios_preliminar}")
    private String realEnviosDir;


    public PlanningResponse schedulePlanning(PlanningRequest request) {
        PlannerAlgorithm algorithm = request.getAlgorithm() != null
                ? request.getAlgorithm()
                : PlannerAlgorithm.IALNS_SA;

        PlanningDataset dataset = resolveDataset(request);
        OptimizationRequest optimizationRequest = buildOptimizationRequest(request, algorithm, dataset);
        OptimizationResponse optimizationResponse = optimizationService.ejecutar(optimizationRequest);

        return PlanningResponse.fromOptimizationResult(
                algorithm,
                request.getScenario(),
                dataset.reference(),
                optimizationResponse.isSimulacionCompleta()
                        ? "COMPLETED"
                        : "COMPLETED_WITH_PENDING_SHIPMENTS",
                buildMessage(request.getScenario(), optimizationResponse),
                optimizationResponse
        );
    }

    private OptimizationRequest buildOptimizationRequest(PlanningRequest request,
                                                         PlannerAlgorithm algorithm,
                                                         PlanningDataset dataset) {
        return OptimizationRequest.of(
                mapAlgorithm(algorithm),
                dataset.aeropuertos().toString(),
                dataset.vuelos().toString(),
                loadShipmentFiles(dataset.enviosDir()),
                request.getEpochHours() != null ? request.getEpochHours() : defaultEpochHours,
                request.getHorizonDays() != null ? request.getHorizonDays() : 1,
                request.getPlanningStart(),
                request.getPopulationSize() != null ? request.getPopulationSize() : defaultPopulationSize,
                request.getTimeLimitSeconds() != null ? request.getTimeLimitSeconds() : defaultTimeLimitSeconds
        );
    }

    private OptimizationAlgorithm mapAlgorithm(PlannerAlgorithm algorithm) {
        return algorithm == PlannerAlgorithm.DHGS ? OptimizationAlgorithm.DHGS : OptimizationAlgorithm.IALNS;
    }

    private PlanningDataset resolveDataset(PlanningRequest request) {
        String reference = request.getDataSetReference();
        if (reference == null || reference.isBlank()) {
            reference = request.getScenario() == OperationalScenario.PERIOD_SIMULATION ? "demo" : "real";
        }

        String normalized = reference.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "demo", "test" -> new PlanningDataset(
                    "demo",
                    resolvePath(demoAeropuertos),
                    resolvePath(demoVuelos),
                    resolvePath(demoEnviosDir)
            );
            case "real" -> new PlanningDataset(
                    "real",
                    resolvePath(realAeropuertos),
                    resolvePath(realVuelos),
                    resolvePath(realEnviosDir)
            );
            default -> throw new IllegalArgumentException(
                    "Dataset no reconocido: " + reference + ". Usa demo, test o real."
            );
        };
    }

    private Path resolvePath(String configuredPath) {
        List<Path> candidates = List.of(
                Paths.get(configuredPath),
                Paths.get("modules", "backend").resolve(configuredPath)
        );

        return candidates.stream()
                .map(Path::normalize)
                .filter(Files::exists)
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("No se encontró la ruta configurada: " + configuredPath));
    }

    private List<String> loadShipmentFiles(Path directory) {
        try (Stream<Path> stream = Files.list(directory)) {
            return stream
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(".txt"))
                    .sorted(Comparator.comparing(path -> path.getFileName().toString()))
                    .map(path -> path.toAbsolutePath().normalize().toString())
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("No se pudieron leer los archivos de envíos en " + directory, e);
        }
    }

    private String buildMessage(OperationalScenario scenario, OptimizationResponse optimizationResponse) {
        String baseMessage = optimizationResponse.getMensaje() != null
                ? optimizationResponse.getMensaje()
                : "Planificación ejecutada.";

        if (scenario == OperationalScenario.COLLAPSE_SIMULATION) {
            return baseMessage + " Nota: el escenario de colapso aún reutiliza la lógica base sin reglas especiales de disrupción.";
        }
        return baseMessage;
    }
    private record PlanningDataset(String reference, Path aeropuertos, Path vuelos, Path enviosDir) {
    }
}

