package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.FlightEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;


import java.util.List;
import java.util.Optional;

@Repository
public interface FlightRepository extends JpaRepository<FlightEntity, Long> {

    Optional<FlightEntity> findByBusinessId(String businessId);

    boolean existsByBusinessId(String businessId);

    List<FlightEntity> findByAeropuertoOrigenCodigoIcaoAndAeropuertoDestinoCodigoIcao(
            String origenIcao, String destinoIcao);

    /** Solo los businessId existentes; evita un SELECT por fila al importar en masa. */
    @Query("select f.businessId from FlightEntity f")
    List<String> findAllBusinessIds();
    
    @Query("""
    select f
    from FlightEntity f
    join fetch f.aeropuertoOrigen
    join fetch f.aeropuertoDestino
    """)
    List<FlightEntity> findAllWithAirports();
    
}
