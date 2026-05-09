package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.ShipmentEntity;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ShipmentRepository {

    Optional<ShipmentEntity> findById(UUID shipmentId);

    ShipmentEntity save(ShipmentEntity shipment);
}

