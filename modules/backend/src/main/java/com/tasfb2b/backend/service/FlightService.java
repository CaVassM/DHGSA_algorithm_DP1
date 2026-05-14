package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.FlightEntity;
import com.tasfb2b.backend.dto.response.FlightResponse;
import com.tasfb2b.backend.exception.ResourceNotFoundException;
import com.tasfb2b.backend.repository.FlightRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class FlightService {

    private final FlightRepository flightRepository;

    public Page<FlightResponse> listAll(Pageable pageable) {
        return flightRepository.findAll(pageable).map(FlightResponse::fromEntity);
    }

    public FlightResponse findById(Long id) {
        FlightEntity entity = flightRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Vuelo " + id + " no encontrado"));
        return FlightResponse.fromEntity(entity);
    }
}
