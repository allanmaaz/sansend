package com.sansend.scheduler;

import com.sansend.entity.FileLink;
import com.sansend.entity.Upload;
import com.sansend.entity.UploadStatus;
import com.sansend.repository.FileLinkRepository;
import com.sansend.repository.UploadRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.AbortMultipartUploadRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class CleanupScheduler {

    private final FileLinkRepository fileLinkRepository;
    private final UploadRepository uploadRepository;
    private final S3Client s3Client;

    @Value("${s3.bucket}")
    private String bucket;

    @Value("${sansend.cleanup.abandoned-upload-hours}")
    private int abandonedUploadHours;

    /**
     * Runs every hour to clean up expired/revoked links and abandoned uploads.
     */
    @Scheduled(cron = "${sansend.cleanup.cron}")
    @Transactional
    public void cleanup() {
        log.info("=== Starting cleanup job ===");

        cleanupExpiredLinks();
        cleanupAbandonedUploads();

        log.info("=== Cleanup job complete ===");
    }

    private void cleanupExpiredLinks() {
        List<FileLink> expiredLinks = fileLinkRepository.findExpiredOrRevoked(Instant.now());

        if (expiredLinks.isEmpty()) {
            log.info("No expired or revoked links found");
            return;
        }

        log.info("Found {} expired/revoked links to clean up", expiredLinks.size());

        for (FileLink link : expiredLinks) {
            Upload upload = link.getUpload();
            String reason = link.getRevoked() ? "revoked" : "expired";

            try {
                // Delete S3 object
                DeleteObjectRequest deleteRequest = DeleteObjectRequest.builder()
                        .bucket(bucket)
                        .key(upload.getS3Key())
                        .build();
                s3Client.deleteObject(deleteRequest);

                log.info("Cleaned up: file={}, size={} bytes, reason={}",
                        upload.getFileName(), upload.getFileSizeBytes(), reason);
            } catch (Exception e) {
                log.error("Failed to delete S3 object for file={}: {}",
                        upload.getFileName(), e.getMessage());
            }

            // Delete file link (cascades to download_events)
            fileLinkRepository.delete(link);

            // Delete upload (cascades to chunks)
            uploadRepository.delete(upload);
        }
    }

    private void cleanupAbandonedUploads() {
        Instant cutoff = Instant.now().minus(abandonedUploadHours, ChronoUnit.HOURS);
        List<Upload> abandonedUploads = uploadRepository
                .findByStatusAndCreatedAtBefore(UploadStatus.IN_PROGRESS, cutoff);

        if (abandonedUploads.isEmpty()) {
            log.info("No abandoned uploads found");
            return;
        }

        log.info("Found {} abandoned uploads to clean up", abandonedUploads.size());

        for (Upload upload : abandonedUploads) {
            try {
                // Abort S3 multipart upload
                AbortMultipartUploadRequest abortRequest = AbortMultipartUploadRequest.builder()
                        .bucket(bucket)
                        .key(upload.getS3Key())
                        .uploadId(upload.getS3MultipartId())
                        .build();
                s3Client.abortMultipartUpload(abortRequest);

                log.info("Aborted abandoned upload: file={}, size={} bytes, reason=abandoned (>{}h)",
                        upload.getFileName(), upload.getFileSizeBytes(), abandonedUploadHours);
            } catch (Exception e) {
                log.error("Failed to abort S3 multipart for file={}: {}",
                        upload.getFileName(), e.getMessage());
            }

            // Update status and delete
            upload.setStatus(UploadStatus.ABORTED);
            uploadRepository.save(upload);
            uploadRepository.delete(upload);
        }
    }
}
