package com.TasfB2B.DHGS.demo.presentation.controller;

import com.TasfB2B.DHGS.demo.application.dto.EpocaResumenDTO;
import com.TasfB2B.DHGS.demo.application.dto.OptimizationRequest;
import com.TasfB2B.DHGS.demo.application.dto.OptimizationResponse;
import com.TasfB2B.DHGS.demo.application.service.OptimizationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Controlador REST para la API de optimización del modelo operativo actual.
 */
@RestController
@RequestMapping("/api/v1/optimization")
public class OptimizationController {

    private final OptimizationService optimizationService;

    public OptimizationController(OptimizationService optimizationService) {
        this.optimizationService = optimizationService;
    }

    /**
     * Ejecuta la optimización completa con el algoritmo solicitado.
     * POST /api/v1/optimization/run
     */
    @PostMapping("/run")
    public ResponseEntity<OptimizationResponse> ejecutar(@RequestBody OptimizationRequest request) {
        OptimizationResponse response = optimizationService.ejecutar(request);
        return ResponseEntity.ok(response);
    }

    /**
     * Obtiene el historial de todas las épocas procesadas.
     * GET /api/v1/optimization/epocas
     */
    @GetMapping("/epocas")
    public ResponseEntity<List<EpocaResumenDTO>> obtenerHistorial() {
        List<EpocaResumenDTO> historial = optimizationService.obtenerHistorial();
        return ResponseEntity.ok(historial);
    }

    /**
     * Obtiene el resumen de una época específica.
     * GET /api/v1/optimization/epocas/{id}
     */
    @GetMapping("/epocas/{id}")
    public ResponseEntity<EpocaResumenDTO> obtenerEpoca(@PathVariable int id) {
        EpocaResumenDTO resumen = optimizationService.obtenerResumenEpoca(id);
        if (resumen == null) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(resumen);
    }

    /**
     * Health check del servicio.
     * GET /api/v1/optimization/health
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, String>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "servicio", "DHGS Optimization Service - Tasf.B2B",
                "version", "1.0.0"
        ));
    }
}
