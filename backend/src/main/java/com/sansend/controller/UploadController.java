package com.sansend.controller;

import com.sansend.dto.*;
import com.sansend.service.RateLimitService;
import com.sansend.service.UploadService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.UUID;

@RestController
@RequestMapping("/api/upload")
@RequiredArgsConstructor
public class UploadController {

    private final UploadService uploadService;
    private final RateLimitService rateLimitService;

    @Value("${sansend.rate-limit.upload-init-max}")
    private int uploadInitMax;

    @Value("${sansend.rate-limit.upload-init-window-seconds}")
    private long uploadInitWindowSeconds;

    @PostMapping("/init")
    public ResponseEntity<UploadInitResponse> initUpload(
            @Valid @RequestBody UploadInitRequest request,
            HttpServletRequest httpRequest) {

        String clientIp = getClientIp(httpRequest);
        if (!rateLimitService.isAllowed(clientIp, uploadInitMax, uploadInitWindowSeconds)) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Rate limit exceeded. Max " + uploadInitMax + " upload inits per hour.");
        }

        UploadInitResponse response = uploadService.initUpload(request);
        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}/presign/{chunkNum}")
    public ResponseEntity<PresignResponse> presignChunk(
            @PathVariable UUID id,
            @PathVariable int chunkNum) {
        return ResponseEntity.ok(uploadService.presignChunk(id, chunkNum));
    }

    @PostMapping("/{id}/chunk/{chunkNum}/confirm")
    public ResponseEntity<Void> confirmChunk(
            @PathVariable UUID id,
            @PathVariable int chunkNum,
            @Valid @RequestBody ChunkConfirmRequest request) {
        uploadService.confirmChunk(id, chunkNum, request.getEtag());
        return ResponseEntity.ok().build();
    }

    @GetMapping("/{id}/status")
    public ResponseEntity<UploadStatusResponse> getStatus(@PathVariable UUID id) {
        return ResponseEntity.ok(uploadService.getStatus(id));
    }

    @PostMapping("/{id}/complete")
    public ResponseEntity<UploadCompleteResponse> completeUpload(
            @PathVariable UUID id,
            @RequestBody(required = false) UploadInitRequest request) {
        return ResponseEntity.ok(uploadService.completeUpload(id, request));
    }

    @DeleteMapping("/{id}/abort")
    public ResponseEntity<Void> abortUpload(@PathVariable UUID id) {
        uploadService.abortUpload(id);
        return ResponseEntity.noContent().build();
    }

    private String getClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isEmpty()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
