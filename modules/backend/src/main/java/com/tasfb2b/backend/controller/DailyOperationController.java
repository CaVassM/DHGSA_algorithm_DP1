package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.request.DailyRegisterRequest;
import com.tasfb2b.backend.dto.response.DailyRegisterResponse;
import com.tasfb2b.backend.dto.response.DailyStateResponse;
import com.tasfb2b.backend.service.DailyOperationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Operación día a día (escenario REAL_TIME): registro manual de envíos uno a
 * uno con descuento de capacidad en vivo. Pantalla independiente del simulador
 * de periodo; no corre el optimizador ni replanifica.
 */
@RestController
@RequestMapping("/api/v1/daily")
@RequiredArgsConstructor
@Tag(name = "Operación día a día",
        description = "Registro manual de envíos en tiempo real con capacidades que se llenan en línea hasta el colapso.")
public class DailyOperationController {

    private final DailyOperationService dailyOperationService;

    @PostMapping("/shipments")
    @Operation(summary = "Registrar un envío manual",
            description = "Valida que exista ruta de vuelos con capacidad y la descuenta en vivo. "
                    + "Si no hay cupo, rechaza (indicio de colapso).")
    public ResponseEntity<DailyRegisterResponse> registrar(@Valid @RequestBody DailyRegisterRequest request) {
        DailyRegisterResponse response = dailyOperationService.registrar(request);
        return response.isAceptado()
                ? ResponseEntity.ok(response)
                : ResponseEntity.unprocessableEntity().body(response);
    }

    @GetMapping("/state")
    @Operation(summary = "Estado actual de las capacidades de la flota",
            description = "Muestra cómo se van llenando los vuelos y si se alcanzó el colapso total.")
    public ResponseEntity<DailyStateResponse> estado() {
        return ResponseEntity.ok(dailyOperationService.estado());
    }

    @PostMapping("/reset")
    @Operation(summary = "Reiniciar la operación día a día",
            description = "Recarga aeropuertos y vuelos desde la BD con capacidad a tope y borra los registros.")
    public ResponseEntity<DailyStateResponse> reiniciar() {
        dailyOperationService.reiniciar();
        return ResponseEntity.ok(dailyOperationService.estado());
    }
}
