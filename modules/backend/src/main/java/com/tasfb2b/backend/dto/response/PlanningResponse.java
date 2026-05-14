package com.tasfb2b.backend.dto.response;

import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * Respuesta del POST /api/v1/planner/runs.
 *
 * Como la corrida es asíncrona, este DTO solo confirma que el run fue
 * aceptado y devuelve los identificadores necesarios para que el cliente
 * haga polling (GET /runs/{id}) hasta ver status final.
 */
@Getter
@NoArgsConstructor(access = AccessLevel.PRIVATE)
public class PlanningResponse {

    private Long runId;
    private PlannerAlgorithm algorithm;
    private OperationalScenario scenario;
    private String dataSetReference;
    private String status;
    private String message;

    public static PlanningResponse forAcceptedRun(Long runId,
                                                  PlannerAlgorithm algorithm,
                                                  OperationalScenario scenario,
                                                  String dataSetReference,
                                                  String status,
                                                  String message) {
        PlanningResponse response = new PlanningResponse();
        response.runId = runId;
        response.algorithm = algorithm;
        response.scenario = scenario;
        response.dataSetReference = dataSetReference;
        response.status = status;
        response.message = message;
        return response;
    }
}
