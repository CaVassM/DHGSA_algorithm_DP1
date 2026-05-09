package com.tasfb2b.backend.dto.request;

import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
public class PlanningRequest {

    // Verificar si es que se va a a alternar entre algoritmos. Yo pienso que no.
    private PlannerAlgorithm algorithm = PlannerAlgorithm.IALNS_SA;

    @NotNull
    private OperationalScenario scenario;

    @NotNull
    private LocalDateTime planningStart;

    @Min(1)
    private Integer horizonDays = 1;

    @Min(1)
    private Long epochHours;

    @Min(1)
    private Integer populationSize;

    @Min(1)
    private Integer timeLimitSeconds;

    private String dataSetReference;
}

