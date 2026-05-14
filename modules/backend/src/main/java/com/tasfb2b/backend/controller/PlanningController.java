package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.dto.response.PlanningResponse;
import com.tasfb2b.backend.dto.response.PlanningRunResponse;
import com.tasfb2b.backend.dto.response.RouteResponse;
import com.tasfb2b.backend.service.PlanningRunService;
import com.tasfb2b.backend.service.PlanningService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/planner")
@RequiredArgsConstructor
@Tag(name = "Planning", description = "Ejecución del optimizador y consulta de corridas y rutas")
public class PlanningController {

    private final PlanningService planningService;
    private final PlanningRunService planningRunService;

    @PostMapping("/runs")
    @Operation(summary = "Crear una corrida de planificación",
            description = "Ejecuta el optimizador (DHGS o IALNS) con el dataset indicado (demo/real/db) y persiste el run con sus rutas.")
    public ResponseEntity<PlanningResponse> createPlanningRun(@Valid @RequestBody PlanningRequest request) {
        return ResponseEntity.accepted().body(planningService.schedulePlanning(request));
    }

    @GetMapping("/runs")
    @Operation(summary = "Listar corridas previas (paginado)")
    public ResponseEntity<Page<PlanningRunResponse>> listRuns(Pageable pageable) {
        return ResponseEntity.ok(planningRunService.listAll(pageable));
    }

    @GetMapping("/runs/{runId}")
    @Operation(summary = "Obtener metadata de una corrida por id")
    public ResponseEntity<PlanningRunResponse> getRun(@PathVariable Long runId) {
        return ResponseEntity.ok(planningRunService.findById(runId));
    }

    @GetMapping("/runs/{runId}/routes")
    @Operation(summary = "Listar las rutas asignadas en una corrida",
            description = "Devuelve cada envío asignado con la secuencia ordenada de vuelos (flightBusinessIds).")
    public ResponseEntity<List<RouteResponse>> getRunRoutes(@PathVariable Long runId) {
        return ResponseEntity.ok(planningRunService.findRoutesByRunId(runId));
    }
}
