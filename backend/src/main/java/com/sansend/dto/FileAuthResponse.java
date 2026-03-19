package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class FileAuthResponse {
    private String token;
}
