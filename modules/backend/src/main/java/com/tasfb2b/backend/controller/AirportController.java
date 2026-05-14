package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.response.AirportResponse;
import com.tasfb2b.backend.service.AirportService;
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
@RequestMapping("/api/v1/airports")
@RequiredArgsConstructor
@Tag(name = "Airports", description = "Consulta de aeropuertos cargados en la BD")
public class AirportController {

    private final AirportService airportService;

    @GetMapping
    @Operation(summary = "Listar aeropuertos (paginado)")
    public ResponseEntity<Page<AirportResponse>> list(Pageable pageable) {
        return ResponseEntity.ok(airportService.listAll(pageable));
    }

    @GetMapping("/{id}")
    @Operation(summary = "Obtener aeropuerto por id interno")
    public ResponseEntity<AirportResponse> findById(@PathVariable Long id) {
        return ResponseEntity.ok(airportService.findById(id));
    }

    @GetMapping("/icao/{icao}")
    @Operation(summary = "Obtener aeropuerto por código ICAO")
    public ResponseEntity<AirportResponse> findByIcao(@PathVariable String icao) {
        return ResponseEntity.ok(airportService.findByIcao(icao));
    }
}
