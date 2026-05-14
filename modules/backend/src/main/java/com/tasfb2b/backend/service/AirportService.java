package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.AirportEntity;
import com.tasfb2b.backend.dto.response.AirportResponse;
import com.tasfb2b.backend.exception.ResourceNotFoundException;
import com.tasfb2b.backend.repository.AirportRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AirportService {

    private final AirportRepository airportRepository;

    public Page<AirportResponse> listAll(Pageable pageable) {
        return airportRepository.findAll(pageable).map(AirportResponse::fromEntity);
    }

    public AirportResponse findById(Long id) {
        AirportEntity entity = airportRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Aeropuerto " + id + " no encontrado"));
        return AirportResponse.fromEntity(entity);
    }

    public AirportResponse findByIcao(String icao) {
        AirportEntity entity = airportRepository.findByCodigoIcao(icao)
                .orElseThrow(() -> new ResourceNotFoundException("Aeropuerto " + icao + " no encontrado"));
        return AirportResponse.fromEntity(entity);
    }
}
