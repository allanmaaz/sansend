package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

import java.util.UUID;

@Data
@Builder
public class UploadInitResponse {
    private UUID uploadId;
    private int totalChunks;
    private long chunkSizeBytes;
    private String ownerToken;
}
