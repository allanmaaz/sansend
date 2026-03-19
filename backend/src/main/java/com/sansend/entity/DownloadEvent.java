package com.sansend.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "download_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DownloadEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "link_id", nullable = false)
    private FileLink fileLink;

    @Column(name = "ip_hash", length = 128)
    private String ipHash;

    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "downloaded_at", nullable = false)
    private Instant downloadedAt;

    @PrePersist
    public void prePersist() {
        if (downloadedAt == null) {
            downloadedAt = Instant.now();
        }
    }
}
