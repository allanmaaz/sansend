package com.sansend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class SansendApplication {

    public static void main(String[] args) {
        SpringApplication.run(SansendApplication.class, args);
    }
}
