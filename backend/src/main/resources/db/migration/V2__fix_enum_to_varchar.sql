-- ============================================
-- V2 — Fix enum type compatibility
-- ============================================

-- Change status column from custom enum to VARCHAR for standard JPA compatibility
ALTER TABLE uploads ALTER COLUMN status TYPE VARCHAR(32);

-- Clean up the now unused type
DROP TYPE IF EXISTS upload_status CASCADE;
