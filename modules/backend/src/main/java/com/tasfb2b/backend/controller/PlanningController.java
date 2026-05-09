package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.dto.response.PlanningResponse;
import com.tasfb2b.backend.service.PlanningService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/planner")
@RequiredArgsConstructor
public class PlanningController {

    private final PlanningService planningService;

    // HTTP POST a /runs
    // Devolvera una respuesta HTTP con body de PlanningResponse.
    // ResponseEntity.accepted() devuelve 202.
    // @RequestBody significa en convertir automaticamente el JSON del request a un objeto Java. En este caso, el PlanningRequest
    // Springboot usa Jackson para eso.
    // @Valid es para validar dtos antes de ejecutar el metodo. Si hay campos nulos o vacios que pide en la clase Request, entonces devuelve un 400 Bad Request
    @PostMapping("/runs")
    public ResponseEntity<PlanningResponse> createPlanningRun(@Valid @RequestBody PlanningRequest request) {
        return ResponseEntity.accepted().body(planningService.schedulePlanning(request));
    }

    // Pendiente en devolver un formado de health. Por ahora es asi, pero quiza un scope adicional y bueno seria
    // que muestre la cantidad de maletas despachadas, etc.
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of(
                "module", "planner",
                "status", "UP",
                "mode", "ALGORITHM_ACTIVE"
        ));
    }
}

