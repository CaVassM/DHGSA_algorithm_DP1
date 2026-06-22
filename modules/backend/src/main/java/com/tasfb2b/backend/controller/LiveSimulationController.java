package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.request.LiveSimulationRequest;
import com.tasfb2b.backend.service.SimulacionEnVivoService;
import com.tasfb2b.backend.service.SimulacionEnVivoService.LiveParams;
import com.tasfb2b.dhgs.demo.application.dto.OptimizationAlgorithm;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Simulación de periodo EN VIVO (salto de algoritmo). El cliente arranca una
 * corrida y se suscribe por WebSocket a {@code /topic/simulacion/{runId}} para
 * recibir el avance época a época.
 */
@RestController
@RequestMapping("/api/v1/simulacion")
@RequiredArgsConstructor
@Tag(name = "Simulación en vivo",
        description = "Simulación de periodo animada con salto de algoritmo; progreso vía WebSocket.")
public class LiveSimulationController {

    private final SimulacionEnVivoService simulacionEnVivoService;
    private final AtomicLong secuencia = new AtomicLong(System.currentTimeMillis());

    @PostMapping("/live")
    @Operation(summary = "Arrancar una simulación de periodo en vivo",
            description = "Devuelve runId y el topic WebSocket donde se emite el progreso por época.")
    public ResponseEntity<Map<String, Object>> iniciar(@Valid @RequestBody LiveSimulationRequest request) {
        Long runId = secuencia.incrementAndGet();

        OptimizationAlgorithm algoritmo = "IALNS".equalsIgnoreCase(request.getAlgorithm())
                ? OptimizationAlgorithm.IALNS : OptimizationAlgorithm.DHGS;

        LiveParams params = new LiveParams(
                algoritmo,
                request.getPlanningStart(),
                request.getEpochHours(),
                request.getHorizonDays(),
                request.getPopulationSize(),
                request.getTimeLimitSeconds(),
                request.getMultiplicadorTemporal(),
                request.isPreBuffer()
        );

        simulacionEnVivoService.iniciar(runId, params);

        return ResponseEntity.accepted().body(Map.of(
                "runId", runId,
                "topic", "/topic/simulacion/" + runId,
                "mensaje", "Simulación en vivo iniciada. Suscríbete al topic para recibir el progreso."
        ));
    }

    @PostMapping("/live/{runId}/cancel")
    @Operation(summary = "Cancelar una simulación en vivo en curso")
    public ResponseEntity<Map<String, Object>> cancelar(@PathVariable Long runId) {
        simulacionEnVivoService.cancelar(runId);
        return ResponseEntity.ok(Map.of("runId", runId, "mensaje", "Cancelación solicitada."));
    }
}
