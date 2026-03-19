package com.sansend.repository;

import com.sansend.entity.FileLink;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FileLinkRepository extends JpaRepository<FileLink, UUID> {

    @Query("SELECT fl FROM FileLink fl JOIN FETCH fl.upload WHERE fl.linkToken = :linkToken")
    Optional<FileLink> findByLinkToken(String linkToken);

    @Query("SELECT fl FROM FileLink fl WHERE fl.expiresAt < :now OR fl.revoked = true")
    List<FileLink> findExpiredOrRevoked(Instant now);

    List<FileLink> findByUploadId(UUID uploadId);
}
