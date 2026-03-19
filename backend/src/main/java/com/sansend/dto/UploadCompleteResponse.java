package com.sansend.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class UploadCompleteResponse {
    private String linkToken;
    private String downloadUrl;
    private String fileName;
    private long fileSizeBytes;
}
