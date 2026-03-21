package com.sansend.service;

import com.sansend.dto.*;
import com.sansend.entity.*;
import com.sansend.repository.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.UploadPartPresignRequest;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@Slf4j
@Service
public class UploadService {

        private static final String CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        private static final SecureRandom RANDOM = new SecureRandom();

        private final S3Client s3Client;
        private final S3Presigner s3Presigner;
        private final String bucket;
        private final long defaultChunkSize;
        private final UploadRepository uploadRepository;
        private final ChunkRepository chunkRepository;
        private final FileLinkRepository fileLinkRepository;
        private final PasswordEncoder passwordEncoder;

        public UploadService(
                        S3Client s3Client,
                        S3Presigner s3Presigner,
                        @Value("${s3.bucket}") String bucket,
                        @Value("${sansend.chunk-size-bytes}") long defaultChunkSize,
                        UploadRepository uploadRepository,
                        ChunkRepository chunkRepository,
                        FileLinkRepository fileLinkRepository,
                        PasswordEncoder passwordEncoder) {
                this.s3Client = s3Client;
                this.s3Presigner = s3Presigner;
                this.bucket = bucket;
                this.defaultChunkSize = defaultChunkSize;
                this.uploadRepository = uploadRepository;
                this.chunkRepository = chunkRepository;
                this.fileLinkRepository = fileLinkRepository;
                this.passwordEncoder = passwordEncoder;
        }

        @Transactional
        public UploadInitResponse initUpload(UploadInitRequest request) {
                long fileSize = request.getFileSizeBytes();
                int totalChunks = (int) Math.ceil((double) fileSize / defaultChunkSize);
                String ownerToken = generateToken(32);
                String s3Key = "uploads/" + UUID.randomUUID() + "/" + request.getFileName();

                // Create S3 multipart upload
                CreateMultipartUploadRequest s3Request = CreateMultipartUploadRequest.builder()
                                .bucket(bucket)
                                .key(s3Key)
                                .contentType(request.getMimeType())
                                .build();

                CreateMultipartUploadResponse s3Response = s3Client.createMultipartUpload(s3Request);

                // Save upload entity
                Upload upload = Upload.builder()
                                .s3MultipartId(s3Response.uploadId())
                                .s3Key(s3Key)
                                .fileName(request.getFileName())
                                .fileSizeBytes(fileSize)
                                .mimeType(request.getMimeType())
                                .status(UploadStatus.IN_PROGRESS)
                                .totalChunks(totalChunks)
                                .chunkSizeBytes(defaultChunkSize)
                                .ownerToken(ownerToken)
                                .build();

                upload = uploadRepository.save(upload);

                log.info("Upload initiated: id={}, file={}, size={}, chunks={}",
                                upload.getId(), request.getFileName(), fileSize, totalChunks);

                return UploadInitResponse.builder()
                                .uploadId(upload.getId())
                                .totalChunks(totalChunks)
                                .chunkSizeBytes(defaultChunkSize)
                                .ownerToken(ownerToken)
                                .build();
        }

        public PresignResponse presignChunk(UUID uploadId, int chunkNumber) {
                Upload upload = getUploadOrThrow(uploadId);

                if (chunkNumber < 1 || chunkNumber > upload.getTotalChunks()) {
                        throw new IllegalArgumentException("Invalid chunk number: " + chunkNumber);
                }

                UploadPartPresignRequest presignRequest = UploadPartPresignRequest.builder()
                                .signatureDuration(Duration.ofMinutes(15))
                                .uploadPartRequest(UploadPartRequest.builder()
                                                .bucket(bucket)
                                                .key(upload.getS3Key())
                                                .partNumber(chunkNumber)
                                                .uploadId(upload.getS3MultipartId())
                                                .build())
                                .build();

                String presignedUrl = s3Presigner.presignUploadPart(presignRequest).url().toString();

                return PresignResponse.builder()
                                .presignedUrl(presignedUrl)
                                .chunkNumber(chunkNumber)
                                .build();
        }

        @Transactional
        public void confirmChunk(UUID uploadId, int chunkNumber, String etag) {
                Upload upload = getUploadOrThrow(uploadId);

                Chunk chunk = Chunk.builder()
                                .id(new ChunkId(uploadId, chunkNumber))
                                .upload(upload)
                                .etag(etag.replace("\"", ""))
                                .build();

                chunkRepository.save(chunk);
                log.debug("Chunk confirmed: uploadId={}, chunk={}", uploadId, chunkNumber);
        }

        public UploadStatusResponse getStatus(UUID uploadId) {
                Upload upload = getUploadOrThrow(uploadId);
                List<Integer> uploadedChunks = chunkRepository.findChunkNumbersByUploadId(uploadId);

                return UploadStatusResponse.builder()
                                .uploadId(uploadId)
                                .status(upload.getStatus().name())
                                .totalChunks(upload.getTotalChunks())
                                .uploadedChunks(uploadedChunks)
                                .build();
        }

        @Transactional
        public UploadCompleteResponse completeUpload(UUID uploadId, UploadInitRequest originalRequest) {
                Upload upload = getUploadOrThrow(uploadId);

                if (upload.getStatus() != UploadStatus.IN_PROGRESS) {
                        throw new IllegalStateException("Upload is not in progress");
                }

                // Query S3 directly for the list of uploaded parts (bypassing browser CORS ETag
                // issues)
                ListPartsRequest listRequest = ListPartsRequest.builder()
                                .bucket(bucket)
                                .key(upload.getS3Key())
                                .uploadId(upload.getS3MultipartId())
                                .build();

                ListPartsResponse listResponse = s3Client.listParts(listRequest);

                if (!listResponse.hasParts() || listResponse.parts().size() != upload.getTotalChunks()) {
                        long found = listResponse.hasParts() ? listResponse.parts().size() : 0;
                        log.error("S3 Parts mismatch for upload {}: expected {}, found {}", uploadId,
                                        upload.getTotalChunks(), found);
                        throw new IllegalStateException("Not all chunks uploaded to S3. Expected: "
                                        + upload.getTotalChunks() + ", found: " + found);
                }

                // Complete S3 multipart upload using S3's exact ETags (with quotes intact)
                List<CompletedPart> completedParts = listResponse.parts().stream()
                                .map(p -> CompletedPart.builder()
                                                .partNumber(p.partNumber())
                                                .eTag(p.eTag())
                                                .build())
                                .collect(Collectors.toList());

                CompleteMultipartUploadRequest s3Request = CompleteMultipartUploadRequest.builder()
                                .bucket(bucket)
                                .key(upload.getS3Key())
                                .uploadId(upload.getS3MultipartId())
                                .multipartUpload(CompletedMultipartUpload.builder()
                                                .parts(completedParts)
                                                .build())
                                .build();

                s3Client.completeMultipartUpload(s3Request);

                // Update upload status
                upload.setStatus(UploadStatus.COMPLETE);
                upload.setCompletedAt(Instant.now());
                uploadRepository.save(upload);

                // Create file link
                String linkToken = generateToken(16);
                Duration expiry = parseExpiry(originalRequest != null ? originalRequest.getExpiresIn() : "24h");

                FileLink fileLink = FileLink.builder()
                                .upload(upload)
                                .linkToken(linkToken)
                                .expiresAt(Instant.now().plus(expiry))
                                .maxDownloads(originalRequest != null ? originalRequest.getMaxDownloads() : null)
                                .build();

                // Hash password if provided
                if (originalRequest != null && originalRequest.getPassword() != null
                                && !originalRequest.getPassword().isBlank()) {
                        fileLink.setPasswordHash(passwordEncoder.encode(originalRequest.getPassword()));
                }

                fileLinkRepository.save(fileLink);

                log.info("Upload completed: id={}, file={}, linkToken={}",
                                uploadId, upload.getFileName(), linkToken);

                return UploadCompleteResponse.builder()
                                .linkToken(linkToken)
                                .downloadUrl("/dl/" + linkToken)
                                .fileName(upload.getFileName())
                                .fileSizeBytes(upload.getFileSizeBytes())
                                .build();
        }

        @Transactional
        public void abortUpload(UUID uploadId) {
                Upload upload = getUploadOrThrow(uploadId);

                // Abort S3 multipart upload
                try {
                        AbortMultipartUploadRequest s3Request = AbortMultipartUploadRequest.builder()
                                        .bucket(bucket)
                                        .key(upload.getS3Key())
                                        .uploadId(upload.getS3MultipartId())
                                        .build();
                        s3Client.abortMultipartUpload(s3Request);
                } catch (Exception e) {
                        log.warn("Failed to abort S3 multipart upload: {}", e.getMessage());
                }

                // Update status and clean up
                upload.setStatus(UploadStatus.ABORTED);
                uploadRepository.save(upload);

                // Delete associated file links
                fileLinkRepository.findByUploadId(uploadId).forEach(fileLinkRepository::delete);

                log.info("Upload aborted: id={}, file={}", uploadId, upload.getFileName());
        }

        private Upload getUploadOrThrow(UUID uploadId) {
                return uploadRepository.findById(uploadId)
                                .orElseThrow(() -> new IllegalArgumentException("Upload not found: " + uploadId));
        }

        private String generateToken(int length) {
                StringBuilder sb = new StringBuilder(length);
                for (int i = 0; i < length; i++) {
                        sb.append(CHARACTERS.charAt(RANDOM.nextInt(CHARACTERS.length())));
                }
                return sb.toString();
        }

        private Duration parseExpiry(String expiresIn) {
                if (expiresIn == null)
                        return Duration.ofHours(24);
                return switch (expiresIn.toLowerCase()) {
                        case "1h" -> Duration.ofHours(1);
                        case "24h" -> Duration.ofHours(24);
                        case "3d" -> Duration.ofDays(3);
                        case "7d" -> Duration.ofDays(7);
                        case "30d" -> Duration.ofDays(30);
                        default -> Duration.ofHours(24);
                };
        }
}
