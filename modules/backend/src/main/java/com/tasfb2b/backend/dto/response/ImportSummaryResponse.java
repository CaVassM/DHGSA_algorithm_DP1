package com.tasfb2b.backend.dto.response;

public record ImportSummaryResponse(
        String resource,
        int parsedCount,
        int insertedCount,
        int updatedCount,
        int skippedCount
) {}
