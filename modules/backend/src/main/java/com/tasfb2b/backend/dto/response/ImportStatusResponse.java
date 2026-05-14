package com.tasfb2b.backend.dto.response;

public record ImportStatusResponse(
        long airportsCount,
        long flightsCount,
        long shipmentsCount
) {}
