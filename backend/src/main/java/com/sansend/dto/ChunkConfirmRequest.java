package com.sansend.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ChunkConfirmRequest {
    @NotBlank
    private String etag;
}
