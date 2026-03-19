-- ============================================
-- Sansend: Large File Transfer Platform
-- V1 — Initial Schema
-- ============================================

-- Upload status enum
CREATE TYPE upload_status AS ENUM ('IN_PROGRESS', 'COMPLETE', 'ABORTED');

-- Uploads table
CREATE TABLE uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    s3_multipart_id VARCHAR(512),
    s3_key          VARCHAR(1024) NOT NULL,
    file_name       VARCHAR(512)  NOT NULL,
    file_size_bytes BIGINT        NOT NULL,
    mime_type       VARCHAR(255),
    status          upload_status NOT NULL DEFAULT 'IN_PROGRESS',
    total_chunks    INTEGER       NOT NULL,
    chunk_size_bytes BIGINT       NOT NULL,
    owner_token     VARCHAR(64)   NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_uploads_status ON uploads(status);
CREATE INDEX idx_uploads_owner_token ON uploads(owner_token);
CREATE INDEX idx_uploads_created_at ON uploads(created_at);

-- Chunks table (composite PK)
CREATE TABLE chunks (
    upload_id    UUID    NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    chunk_number INTEGER NOT NULL,
    etag         VARCHAR(256) NOT NULL,
    uploaded_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (upload_id, chunk_number)
);

-- File links table
CREATE TABLE file_links (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    upload_id      UUID         NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    link_token     VARCHAR(16)  NOT NULL UNIQUE,
    password_hash  VARCHAR(256),
    max_downloads  INTEGER,
    download_count INTEGER      NOT NULL DEFAULT 0,
    expires_at     TIMESTAMPTZ  NOT NULL,
    revoked        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_file_links_link_token ON file_links(link_token);
CREATE INDEX idx_file_links_expires_at ON file_links(expires_at);
CREATE INDEX idx_file_links_upload_id ON file_links(upload_id);

-- Download events table
CREATE TABLE download_events (
    id            BIGSERIAL PRIMARY KEY,
    link_id       UUID         NOT NULL REFERENCES file_links(id) ON DELETE CASCADE,
    ip_hash       VARCHAR(128),
    user_agent    VARCHAR(512),
    downloaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_download_events_link_id ON download_events(link_id);
