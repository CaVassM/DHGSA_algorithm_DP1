package com.tasfb2b.backend.service;

import com.tasfb2b.backend.domain.model.PlanningRunEntity;
import com.tasfb2b.backend.dto.response.PlanningRunResponse;
import com.tasfb2b.backend.dto.response.RouteResponse;
import com.tasfb2b.backend.exception.ResourceNotFoundException;
import com.tasfb2b.backend.repository.PlanningRunRepository;
import com.tasfb2b.backend.repository.RouteRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
public class PlanningRunService {

    private final PlanningRunRepository planningRunRepository;
    private final RouteRepository routeRepository;

    public Page<PlanningRunResponse> listAll(Pageable pageable) {
        return planningRunRepository.findAll(pageable).map(PlanningRunResponse::fromEntity);
    }

    public PlanningRunResponse findById(Long id) {
        PlanningRunEntity entity = planningRunRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("PlanningRun " + id + " no encontrado"));
        return PlanningRunResponse.fromEntity(entity);
    }

    @Transactional(readOnly = true)
    public List<RouteResponse> findRoutesByRunId(Long runId) {
        if (!planningRunRepository.existsById(runId)) {
            throw new ResourceNotFoundException("PlanningRun " + runId + " no encontrado");
        }
        return routeRepository.findByPlanningRunIdWithLegs(runId).stream()
                .map(RouteResponse::fromEntity)
                .toList();
    }
}
