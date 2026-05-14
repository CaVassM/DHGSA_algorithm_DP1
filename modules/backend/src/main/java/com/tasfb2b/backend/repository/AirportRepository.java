package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.AirportEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface AirportRepository extends JpaRepository<AirportEntity, Long> {

    Optional<AirportEntity> findByCodigoIcao(String codigoIcao);

    boolean existsByCodigoIcao(String codigoIcao);
}
