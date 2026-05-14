package com.tasfb2b.backend.controller;

import com.tasfb2b.backend.dto.response.ImportStatusResponse;
import com.tasfb2b.backend.dto.response.ImportSummaryResponse;
import com.tasfb2b.backend.service.AdminImportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.http.MediaType;

@RestController
@RequestMapping("/api/v1/admin/imports")
@RequiredArgsConstructor
@Tag(name = "Admin Imports", description = "Carga inicial de datos maestros desde archivos .txt a PostgreSQL")
public class AdminImportController {

    private final AdminImportService adminImportService;

    @GetMapping("/status")
    @Operation(summary = "Contadores de datos cargados (para que el frontend decida si saltar la pantalla de import)")
    public ResponseEntity<ImportStatusResponse> status() {
        return ResponseEntity.ok(adminImportService.status());
    }

    @PostMapping(value = "/airports", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Importar aeropuertos (estudiantes.txt). Upsert por código ICAO.")
    public ResponseEntity<ImportSummaryResponse> importAirports(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.ok(adminImportService.importAirports(file));
    }

    @PostMapping(value = "/flights", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Importar vuelos plantilla (planes_vuelo.txt). Requiere aeropuertos previos. Upsert por businessId.")
    public ResponseEntity<ImportSummaryResponse> importFlights(@RequestParam("file") MultipartFile file) {
        return ResponseEntity.ok(adminImportService.importFlights(file));
    }

    @PostMapping(value = "/shipments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Importar envíos (uno o varios envios_XXXX_.txt). Origen inferido del nombre. Upsert por businessId.")
    public ResponseEntity<ImportSummaryResponse> importShipments(@RequestParam("files") MultipartFile[] files) {
        return ResponseEntity.ok(adminImportService.importShipments(files));
    }
}
