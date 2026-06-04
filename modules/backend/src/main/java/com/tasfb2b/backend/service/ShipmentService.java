package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.ShipmentEntity;
import com.tasfb2b.backend.dto.response.ShipmentResponse;
import com.tasfb2b.backend.exception.ResourceNotFoundException;
import com.tasfb2b.backend.repository.ShipmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ShipmentService {

    private final ShipmentRepository shipmentRepository;

    @Transactional(readOnly = true)
    public Page<ShipmentResponse> listAll(Pageable pageable) {
        return shipmentRepository.findAll(pageable).map(ShipmentResponse::fromEntity);
    }

    @Transactional(readOnly = true)
    public ShipmentResponse findById(Long id) {
        ShipmentEntity entity = shipmentRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Envio " + id + " no encontrado"));
        return ShipmentResponse.fromEntity(entity);
    }
}
