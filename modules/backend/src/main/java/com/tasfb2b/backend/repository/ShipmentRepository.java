package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.ShipmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.repository.query.Param;



@Repository

public interface ShipmentRepository extends JpaRepository<ShipmentEntity, Long> {

    Optional<ShipmentEntity> findByBusinessId(String businessId);
    
    Optional<ShipmentEntity> findByBusinessIdAndAeropuertoOrigen_Id(String businessId, Long origenId);

    List<ShipmentEntity> findByFechaHoraCreacionBetween(LocalDateTime start, LocalDateTime end);

    /** Envío más antiguo por fecha de creación; infiere el inicio de una simulación sin cargar todo. */
    Optional<ShipmentEntity> findFirstByOrderByFechaHoraCreacionAsc();

    boolean existsByBusinessId(String businessId);

    /** Solo los businessId existentes; evita un SELECT por fila al importar en masa. */
    @Query("select s.businessId from ShipmentEntity s")
    List<String> findAllBusinessIds();
    
    @Query("""
    select s
    from ShipmentEntity s
    join fetch s.aeropuertoOrigen
    join fetch s.aeropuertoDestino
    where s.fechaHoraCreacion >= :inicio
      and s.fechaHoraCreacion < :fin
    """)
    List<ShipmentEntity> findByFechaHoraCreacionBetweenWithAirports(
            @Param("inicio") LocalDateTime inicio,
            @Param("fin") LocalDateTime fin
    );
}
