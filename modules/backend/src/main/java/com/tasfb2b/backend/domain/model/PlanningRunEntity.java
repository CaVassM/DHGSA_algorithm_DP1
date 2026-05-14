package com.tasfb2b.backend.domain.model;

import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.domain.enums.PlanningRunStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(name = "planning_runs")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PlanningRunEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private PlannerAlgorithm algorithm;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private OperationalScenario scenario;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 48)
    private PlanningRunStatus status;

    @Column(name = "data_set_reference", length = 64)
    private String dataSetReference;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    @Column(name = "costo_total")
    private Double costoTotal;

    @Column(name = "total_envios_asignados")
    private Integer totalEnviosAsignados;

    @Column(name = "total_envios_no_asignados")
    private Integer totalEnviosNoAsignados;

    @Column(name = "total_maletas_despachadas")
    private Integer totalMaletasDespachadas;

    @Column(name = "mensaje", length = 1024)
    private String mensaje;
}
