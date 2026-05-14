package com.tasfb2b.backend.repository;

import com.tasfb2b.backend.domain.model.AirportEntity;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("test")
class AirportRepositoryTest {

    @Autowired
    private AirportRepository airportRepository;

    @Test
    void findByCodigoIcao_returnsSavedAirport() {
        AirportEntity saved = airportRepository.save(AirportEntity.builder()
                .idNegocio(1)
                .codigoIcao("SKBO")
                .ciudad("Bogota")
                .pais("Colombia")
                .continente("America del Sur")
                .capacidadAlmacen(430)
                .latitud(4.7)
                .longitud(-74.14)
                .gmt(-5)
                .build());

        Optional<AirportEntity> found = airportRepository.findByCodigoIcao("SKBO");
        assertThat(found).isPresent();
        assertThat(found.get().getId()).isEqualTo(saved.getId());
        assertThat(airportRepository.existsByCodigoIcao("SKBO")).isTrue();
        assertThat(airportRepository.existsByCodigoIcao("XXXX")).isFalse();
    }
}
