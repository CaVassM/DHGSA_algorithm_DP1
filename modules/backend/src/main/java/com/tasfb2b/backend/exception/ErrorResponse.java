package com.tasfb2b.backend.exception;

import java.util.List;

public record ErrorResponse(String errorCode, String message, List<String> details) {

    public static ErrorResponse of(String errorCode, String message) {
        return new ErrorResponse(errorCode, message, List.of());
    }
}
