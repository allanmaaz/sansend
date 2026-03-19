package com.sansend.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "chunks")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Chunk {

    @EmbeddedId
    private ChunkId id;

    @ManyToOne(fetch = FetchType.LAZY)
    @MapsId("uploadId")
    @JoinColumn(name = "upload_id")
    private Upload upload;

    @Column(name = "etag", nullable = false, length = 256)
    private String etag;

    @Column(name = "uploaded_at", nullable = false)
    private Instant uploadedAt;

    @PrePersist
    public void prePersist() {
        if (uploadedAt == null) {
            uploadedAt = Instant.now();
        }
    }
}
