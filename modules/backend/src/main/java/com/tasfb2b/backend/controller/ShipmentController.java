package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.response.ShipmentResponse;
import com.tasfb2b.backend.service.ShipmentService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/shipments")
@RequiredArgsConstructor
@Tag(name = "Shipments", description = "Consulta de envíos (Envio) cargados en la BD")
public class ShipmentController {

    private final ShipmentService shipmentService;

    @GetMapping
    @Operation(summary = "Listar envíos (paginado)")
    public ResponseEntity<Page<ShipmentResponse>> list(Pageable pageable) {
        return ResponseEntity.ok(shipmentService.listAll(pageable));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Obtener envío por id interno")
    public ResponseEntity<ShipmentResponse> findById(@PathVariable Long id) {
        return ResponseEntity.ok(shipmentService.findById(id));
    }
}
