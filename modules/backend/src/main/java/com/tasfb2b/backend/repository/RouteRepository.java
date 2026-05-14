package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.RouteEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RouteRepository extends JpaRepository<RouteEntity, Long> {

    @Query("""
            select r from RouteEntity r
            left join fetch r.legs l
            left join fetch l.flight
            where r.planningRun.id = :runId
            order by r.id asc
            """)
    List<RouteEntity> findByPlanningRunIdWithLegs(@Param("runId") Long runId);
}
