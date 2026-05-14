package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.PlanningRunEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PlanningRunRepository extends JpaRepository<PlanningRunEntity, Long> {
}
