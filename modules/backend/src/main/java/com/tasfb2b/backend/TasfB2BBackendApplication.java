package com.tasfb2b.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = {
        "com.tasfb2b.backend",
        "com.tasfb2b.dhgs.demo.application.service",
        "com.tasfb2b.dhgs.demo.domain.service",
        "com.tasfb2b.dhgs.demo.infraestructure"
})
public class TasfB2BBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(TasfB2BBackendApplication.class, args);
    }
}

