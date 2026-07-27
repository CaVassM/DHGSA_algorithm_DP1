package com.tasfb2b.backend.domain.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Table(
        name = "ruta_legs",
        uniqueConstraints = @UniqueConstraint(name = "uk_ruta_legs_order", columnNames = {"route_id", "leg_order"}),
        indexes = @Index(name = "idx_ruta_legs_route", columnList = "route_id")
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RouteLegEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "route_id", nullable = false)
    private RouteEntity route;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "flight_id", nullable = false)
    private FlightEntity flight;

    @Column(name = "leg_order", nullable = false)
    private Integer legOrder;

    /**
     * Salida/llegada REALES de esta ocurrencia de vuelo, ya convertidas a UTC
     * (instante absoluto), no la hora de pared del catálogo.
     *
     * <p>Antes no se guardaban: el leg solo enlazaba a la plantilla
     * ({@link #flight}), y el frontend tenía que reconstruir el horario de cada
     * tramo a mano a partir de la hora local de la plantilla y la duración,
     * encadenando tramos sin tener en cuenta que cada punta vive en un huso
     * distinto. Esa reconstrucción es la causa de que el mapa en vivo no
     * mostrara todos los aviones realmente en vuelo. Guardando aquí el instante
     * real de la instancia que el algoritmo asignó, el frontend ya no necesita
     * adivinar nada.
     */
    @Column(name = "salida_utc")
    private LocalDateTime salidaUtc;

    @Column(name = "llegada_utc")
    private LocalDateTime llegadaUtc;
}