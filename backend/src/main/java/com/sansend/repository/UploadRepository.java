package com.sansend.repository;

import com.sansend.entity.Upload;
import com.sansend.entity.UploadStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Repository
public interface UploadRepository extends JpaRepository<Upload, UUID> {

    List<Upload> findByStatusAndCreatedAtBefore(UploadStatus status, Instant cutoff);
}
