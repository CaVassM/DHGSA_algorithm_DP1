package com.tasfb2b.backend.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalTime;

@Entity
@Table(
        name = "vuelos",
        indexes = {
                @Index(name = "idx_vuelos_business_id", columnList = "business_id", unique = true),
                @Index(name = "idx_vuelos_origen_destino", columnList = "origen_id,destino_id")
        }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FlightEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "business_id", nullable = false, length = 64)
    private String businessId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "origen_id", nullable = false)
    private AirportEntity aeropuertoOrigen;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "destino_id", nullable = false)
    private AirportEntity aeropuertoDestino;

    @Column(name = "hora_salida", nullable = false)
    private LocalTime horaSalida;

    @Column(name = "hora_llegada", nullable = false)
    private LocalTime horaLlegada;

    @Column(nullable = false)
    private Integer capacidad;

    @Column(name = "capacidad_disponible", nullable = false)
    private Integer capacidadDisponible;

    @Column(nullable = false)
    private Double distancia;

    @Column(name = "duracion_minutos", nullable = false)
    private Long duracionMinutos;
}
