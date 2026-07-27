package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.ShipmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Collection;
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

    /**
     * Envío más reciente por fecha de creación. Junto con el más antiguo acota
     * el periodo con datos, que es lo que hay que decirle a quien eligió una
     * fecha de simulación vacía.
     */
    Optional<ShipmentEntity> findFirstByOrderByFechaHoraCreacionDesc();

    boolean existsByBusinessId(String businessId);

    /** Solo los businessId existentes; evita un SELECT por fila al importar en masa. */
    @Query("select s.businessId from ShipmentEntity s")
    List<String> findAllBusinessIds();

    /**
     * Los envíos de un conjunto de businessId, en una sola consulta.
     *
     * <p>Persistir las rutas de una época hacía un SELECT por envío
     * ({@code findByBusinessIdAndAeropuertoOrigen_Id} en bucle): con ~1.800
     * envíos por época eran ~1.800 idas y vueltas a Postgres dentro del hilo
     * que anima la simulación, y la reproducción se congelaba. Trayéndolos de
     * golpe, quien persiste resuelve el par (businessId, aeropuertoOrigen) en
     * memoria.
     */
    @Query("""
    select s
    from ShipmentEntity s
    where s.businessId in :businessIds
    """)
    List<ShipmentEntity> findAllByBusinessIdIn(@Param("businessIds") Collection<String> businessIds);
    
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
