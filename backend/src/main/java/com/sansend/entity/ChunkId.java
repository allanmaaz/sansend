package com.sansend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import lombok.*;

import java.io.Serializable;
import java.util.UUID;

@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ChunkId implements Serializable {

    @Column(name = "upload_id")
    private UUID uploadId;

    @Column(name = "chunk_number")
    private Integer chunkNumber;
}
