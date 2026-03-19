package com.sansend.controller;

import com.sansend.dto.FileAuthRequest;
import com.sansend.dto.FileAuthResponse;
import com.sansend.dto.FileMetadataResponse;
import com.sansend.service.FileService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

@RestController
@RequestMapping("/api/file")
@RequiredArgsConstructor
public class FileController {

    private final FileService fileService;

    @GetMapping("/{linkId}")
    public ResponseEntity<FileMetadataResponse> getMetadata(@PathVariable String linkId) {
        return ResponseEntity.ok(fileService.getMetadata(linkId));
    }

    @PostMapping("/{linkId}/auth")
    public ResponseEntity<FileAuthResponse> authenticate(
            @PathVariable String linkId,
            @Valid @RequestBody FileAuthRequest request) {
        String token = fileService.authenticate(linkId, request.getPassword());
        return ResponseEntity.ok(FileAuthResponse.builder().token(token).build());
    }

    @GetMapping("/{linkId}/download")
    public ResponseEntity<Void> download(
            @PathVariable String linkId,
            @RequestParam(required = false) String token,
            HttpServletRequest httpRequest) {

        String ipHash = hashIp(getClientIp(httpRequest));
        String userAgent = httpRequest.getHeader("User-Agent");

        String downloadUrl = fileService.download(linkId, token, ipHash, userAgent);

        return ResponseEntity.status(HttpStatus.FOUND)
                .location(URI.create(downloadUrl))
                .build();
    }

    @DeleteMapping("/{linkId}")
    public ResponseEntity<Void> revoke(
            @PathVariable String linkId,
            @RequestHeader("X-Owner-Token") String ownerToken) {
        fileService.revoke(linkId, ownerToken);
        return ResponseEntity.noContent().build();
    }

    private String getClientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isEmpty()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }

    private String hashIp(String ip) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(ip.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            return ip;
        }
    }
}
