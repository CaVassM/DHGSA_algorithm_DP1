package com.tasfb2b.backend.domain.model;

import com.tasfb2b.backend.domain.enums.OperationalScenario;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "shipments")
@Getter
@Setter
public class ShipmentEntity {

    @Id
    private UUID id;

    private String originAirportCode;
    private String destinationAirportCode;
    private LocalDateTime createdAt;

    @Enumerated(EnumType.STRING)
    private OperationalScenario scenario;
}

