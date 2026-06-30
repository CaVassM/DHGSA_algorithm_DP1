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
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "envios",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_envios_business_origen",
                        columnNames = {"business_id", "origen_id"}
                )
        },
        indexes = {
                @Index(name = "idx_envios_fecha_creacion", columnList = "fecha_hora_creacion"),
                @Index(name = "idx_envios_origen", columnList = "origen_id")
        }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ShipmentEntity {

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

    @Column(name = "fecha_hora_creacion", nullable = false)
    private LocalDateTime fechaHoraCreacion;

    @Column(name = "cantidad_maletas", nullable = false)
    private Integer cantidadMaletas;

    @Column(name = "id_cliente", nullable = false, length = 32)
    private String idCliente;

    @Column
    private LocalDateTime deadline;

    @Column(name = "es_must_go", nullable = false)
    private boolean esMustGo;

    @Column(nullable = false)
    private Integer prioridad;
}
