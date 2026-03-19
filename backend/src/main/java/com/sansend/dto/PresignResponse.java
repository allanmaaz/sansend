package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class PresignResponse {
    private String presignedUrl;
    private int chunkNumber;
}
