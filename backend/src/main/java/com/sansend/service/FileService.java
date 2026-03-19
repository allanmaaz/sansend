package com.sansend.service;

import com.sansend.config.JwtUtil;
import com.sansend.dto.FileMetadataResponse;
import com.sansend.entity.DownloadEvent;
import com.sansend.entity.FileLink;
import com.sansend.entity.Upload;
import com.sansend.repository.DownloadEventRepository;
import com.sansend.repository.FileLinkRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;

import java.time.Duration;
import java.time.Instant;

@Slf4j
@Service
@RequiredArgsConstructor
public class FileService {

    private final FileLinkRepository fileLinkRepository;
    private final DownloadEventRepository downloadEventRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;
    private final S3Presigner s3Presigner;

    @Value("${s3.bucket}")
    private String bucket;

    @Transactional(readOnly = true)
    public FileMetadataResponse getMetadata(String linkToken) {
        FileLink link = findLinkOrThrow(linkToken);
        Upload upload = link.getUpload();

        return FileMetadataResponse.builder()
                .fileName(upload.getFileName())
                .fileSizeBytes(upload.getFileSizeBytes())
                .mimeType(upload.getMimeType())
                .expiresAt(link.getExpiresAt())
                .downloadCount(link.getDownloadCount())
                .maxDownloads(link.getMaxDownloads())
                .passwordProtected(link.getPasswordHash() != null)
                .createdAt(link.getCreatedAt())
                .build();
    }

    public String authenticate(String linkToken, String password) {
        FileLink link = findLinkOrThrow(linkToken);

        if (link.getPasswordHash() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "This file is not password-protected");
        }

        if (!passwordEncoder.matches(password, link.getPasswordHash())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Wrong password");
        }

        return jwtUtil.generateToken(linkToken);
    }

    @Transactional
    public String download(String linkToken, String authToken, String ipHash, String userAgent) {
        FileLink link = findLinkOrThrow(linkToken);

        // Check if expired
        if (link.getExpiresAt().isBefore(Instant.now())) {
            throw new ResponseStatusException(HttpStatus.GONE, "This link has expired");
        }

        // Check if revoked
        if (link.getRevoked()) {
            throw new ResponseStatusException(HttpStatus.GONE, "This link has been revoked");
        }

        // Check download limit
        if (link.getMaxDownloads() != null && link.getDownloadCount() >= link.getMaxDownloads()) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,
                    "Download limit reached");
        }

        // Check password auth
        if (link.getPasswordHash() != null) {
            if (authToken == null || authToken.isBlank()) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Password authentication required");
            }
            try {
                String subject = jwtUtil.validateTokenAndGetSubject(authToken);
                if (!linkToken.equals(subject)) {
                    throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Invalid token");
                }
            } catch (Exception e) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "Invalid or expired authentication token");
            }
        }

        // Increment download count
        link.setDownloadCount(link.getDownloadCount() + 1);
        fileLinkRepository.save(link);

        // Log download event
        DownloadEvent event = DownloadEvent.builder()
                .fileLink(link)
                .ipHash(ipHash)
                .userAgent(userAgent)
                .build();
        downloadEventRepository.save(event);

        // Generate presigned download URL
        Upload upload = link.getUpload();
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(Duration.ofMinutes(15))
                .getObjectRequest(GetObjectRequest.builder()
                        .bucket(bucket)
                        .key(upload.getS3Key())
                        .responseContentDisposition("attachment; filename=\"" + upload.getFileName() + "\"")
                        .build())
                .build();

        String downloadUrl = s3Presigner.presignGetObject(presignRequest).url().toString();

        log.info("Download served: link={}, file={}, count={}",
                linkToken, upload.getFileName(), link.getDownloadCount());

        return downloadUrl;
    }

    @Transactional
    public void revoke(String linkToken, String ownerToken) {
        FileLink link = findLinkOrThrow(linkToken);
        Upload upload = link.getUpload();

        if (!upload.getOwnerToken().equals(ownerToken)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Invalid owner token");
        }

        link.setRevoked(true);
        fileLinkRepository.save(link);

        log.info("Link revoked: token={}, file={}", linkToken, upload.getFileName());
    }

    private FileLink findLinkOrThrow(String linkToken) {
        return fileLinkRepository.findByLinkToken(linkToken)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "File not found"));
    }
}
