package com.sansend.repository;

import com.sansend.entity.Chunk;
import com.sansend.entity.ChunkId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface ChunkRepository extends JpaRepository<Chunk, ChunkId> {

    @Query("SELECT c.id.chunkNumber FROM Chunk c WHERE c.id.uploadId = :uploadId ORDER BY c.id.chunkNumber")
    List<Integer> findChunkNumbersByUploadId(@Param("uploadId") UUID uploadId);

    List<Chunk> findByIdUploadId(UUID uploadId);
}
