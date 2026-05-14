package com.tasfb2b.backend.domain.model;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(
        name = "rutas",
        indexes = {
                @Index(name = "idx_rutas_run", columnList = "planning_run_id"),
                @Index(name = "idx_rutas_shipment", columnList = "shipment_id")
        }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RouteEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "planning_run_id", nullable = false)
    private PlanningRunEntity planningRun;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "shipment_id", nullable = false)
    private ShipmentEntity shipment;

    @Column(name = "tiempo_inicio")
    private LocalDateTime tiempoInicio;

    @Column(name = "tiempo_llegada_estimado")
    private LocalDateTime tiempoLlegadaEstimado;

    @Column(name = "distancia_total")
    private Double distanciaTotal;

    @Column(name = "es_directa", nullable = false)
    private boolean esDirecta;

    @Column(nullable = false)
    private Integer escalas;

    @OneToMany(mappedBy = "route", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("legOrder ASC")
    @Builder.Default
    private List<RouteLegEntity> legs = new ArrayList<>();
}
