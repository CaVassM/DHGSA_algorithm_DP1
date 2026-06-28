package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.ShipmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ShipmentRepository extends JpaRepository<ShipmentEntity, Long> {

    Optional<ShipmentEntity> findByBusinessId(String businessId);

    List<ShipmentEntity> findByFechaHoraCreacionBetween(LocalDateTime start, LocalDateTime end);

    /** Envío más antiguo por fecha de creación; infiere el inicio de una simulación sin cargar todo. */
    Optional<ShipmentEntity> findFirstByOrderByFechaHoraCreacionAsc();

    boolean existsByBusinessId(String businessId);

    /** Solo los businessId existentes; evita un SELECT por fila al importar en masa. */
    @Query("select s.businessId from ShipmentEntity s")
    List<String> findAllBusinessIds();
}
