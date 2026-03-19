package com.sansend.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class UploadInitRequest {

    @NotBlank
    private String fileName;

    @NotNull
    @Min(1)
    private Long fileSizeBytes;

    private String mimeType;

    /** Expiry duration: 1h, 24h, 3d, 7d, 30d */
    private String expiresIn;

    /** Optional max download count */
    private Integer maxDownloads;

    /** Optional password for the download link */
    private String password;
}
