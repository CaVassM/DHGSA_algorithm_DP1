package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.response.FlightResponse;
import com.tasfb2b.backend.service.FlightService;
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
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/v1/flights")
@RequiredArgsConstructor
@Tag(name = "Flights", description = "Consulta de vuelos plantilla cargados en la BD")
public class FlightController {

    private final FlightService flightService;

    @GetMapping
    @Operation(summary = "Listar vuelos (paginado)")
    @Transactional(readOnly = true)
    public ResponseEntity<Page<FlightResponse>> list(Pageable pageable) {
        return ResponseEntity.ok(flightService.listAll(pageable));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Obtener vuelo por id interno")
    public ResponseEntity<FlightResponse> findById(@PathVariable Long id) {
        return ResponseEntity.ok(flightService.findById(id));
    }
}
