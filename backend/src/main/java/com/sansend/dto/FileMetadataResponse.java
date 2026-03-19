package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

import java.time.Instant;

@Data
@Builder
public class FileMetadataResponse {
    private String fileName;
    private long fileSizeBytes;
    private String mimeType;
    private Instant expiresAt;
    private int downloadCount;
    private Integer maxDownloads;
    private boolean passwordProtected;
    private Instant createdAt;
}
