package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.domain.enums.PlanningRunStatus;
import com.tasfb2b.backend.domain.model.PlanningRunEntity;

import java.time.LocalDateTime;

public record PlanningRunResponse(
        Long id,
        PlannerAlgorithm algorithm,
        OperationalScenario scenario,
        PlanningRunStatus status,
        String dataSetReference,
        LocalDateTime startedAt,
        LocalDateTime finishedAt,
        Double costoTotal,
        Integer totalEnviosAsignados,
        Integer totalEnviosNoAsignados,
        Integer totalMaletasDespachadas,
        String mensaje
) {
    public static PlanningRunResponse fromEntity(PlanningRunEntity entity) {
        return new PlanningRunResponse(
                entity.getId(),
                entity.getAlgorithm(),
                entity.getScenario(),
                entity.getStatus(),
                entity.getDataSetReference(),
                entity.getStartedAt(),
                entity.getFinishedAt(),
                entity.getCostoTotal(),
                entity.getTotalEnviosAsignados(),
                entity.getTotalEnviosNoAsignados(),
                entity.getTotalMaletasDespachadas(),
                entity.getMensaje()
        );
    }
}
