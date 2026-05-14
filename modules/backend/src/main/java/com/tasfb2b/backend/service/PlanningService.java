package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.enums.DataSetReference;
import com.tasfb2b.backend.domain.enums.OperationalScenario;
import com.tasfb2b.backend.domain.enums.PlannerAlgorithm;
import com.tasfb2b.backend.domain.enums.PlanningRunStatus;
import com.tasfb2b.backend.domain.model.PlanningRunEntity;
import com.tasfb2b.backend.dto.request.PlanningRequest;
import com.tasfb2b.backend.dto.response.PlanningResponse;
import com.tasfb2b.backend.repository.PlanningRunRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

/**
 * Punto de entrada del flujo de planificación.
 *
 * Responsabilidad: validar el request, crear el run en estado RUNNING, y
 * disparar la ejecución async. La lógica pesada (optimización + persistencia
 * de rutas) vive en {@link PlanningRunExecutor} — ese desacople es necesario
 * para que el proxy de Spring AOP intercepte el {@code @Async} (self-invocation
 * en la misma clase no funciona).
 */
@Service
@RequiredArgsConstructor
public class PlanningService {

    private final PlanningRunRepository planningRunRepository;
    private final PlanningRunExecutor planningRunExecutor;

    @Transactional
    public PlanningResponse schedulePlanning(PlanningRequest request) {
        PlannerAlgorithm algorithm = request.getAlgorithm() != null
                ? request.getAlgorithm() : PlannerAlgorithm.IALNS_SA;
        DataSetReference reference = resolveReference(request);

        PlanningRunEntity run = planningRunRepository.save(PlanningRunEntity.builder()
                .algorithm(algorithm)
                .scenario(request.getScenario())
                .status(PlanningRunStatus.RUNNING)
                .dataSetReference(reference.name())
                .startedAt(LocalDateTime.now())
                .build());

        planningRunExecutor.executeRun(run.getId(), request, algorithm, reference);

        return PlanningResponse.forAcceptedRun(
                run.getId(),
                algorithm,
                request.getScenario(),
                reference.name(),
                run.getStatus().name(),
                "Corrida aceptada. Hacé polling a GET /api/v1/planner/runs/" + run.getId()
                        + " para ver el progreso."
        );
    }

    private DataSetReference resolveReference(PlanningRequest request) {
        DataSetReference reference = request.getDataSetReference();
        if (reference == null) {
            return request.getScenario() == OperationalScenario.PERIOD_SIMULATION
                    ? DataSetReference.DEMO
                    : DataSetReference.REAL;
        }
        return reference;
    }
}
