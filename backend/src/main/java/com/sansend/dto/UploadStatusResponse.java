package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

import java.util.List;
import java.util.UUID;

@Data
@Builder
public class UploadStatusResponse {
    private UUID uploadId;
    private String status;
    private int totalChunks;
    private List<Integer> uploadedChunks;
}
