# Sansend

Large file transfer platform (50GB+) built with Spring Boot 3 + Java 21 and React + TypeScript + Tailwind CSS.

## Features

- **Chunked multipart uploads** via AWS S3 (supports 50GB+ files)
- **Shareable download links** with optional password protection
- **Configurable expiry** (1h / 24h / 3d / 7d / 30d) and download limits
- **QR code generation** for easy mobile sharing
- **Automatic cleanup** of expired files and abandoned uploads
- **Rate limiting** via Redis (5 upload inits per IP per hour)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Spring Boot 3.2, Java 21 |
| Database | PostgreSQL 15, Flyway migrations |
| Cache | Redis 7 |
| Storage | AWS S3 (or MinIO for local dev) |
| Frontend | React 18, TypeScript, Tailwind CSS, React Query |
| Auth | BCrypt passwords, JWT download tokens |

## Getting Started

### Prerequisites
- Java 21
- Node.js 18+
- Docker & Docker Compose

### Local Development

```bash
# Start infrastructure (PostgreSQL, Redis, MinIO)
docker-compose up -d postgres redis minio

# Run backend
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=dev

# Run frontend
cd frontend
npm install
npm run dev
```

### Docker (Full Stack)

```bash
docker-compose up --build
```

The app will be available at:
- Frontend: http://localhost:3000
- Backend API: http://localhost:8080
- Swagger UI: http://localhost:8080/swagger-ui.html
- MinIO Console: http://localhost:9001

## API Endpoints

### Upload
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload/init` | Initialize multipart upload |
| GET | `/api/upload/{id}/presign/{chunkNum}` | Get presigned upload URL |
| POST | `/api/upload/{id}/chunk/{chunkNum}/confirm` | Confirm chunk upload |
| GET | `/api/upload/{id}/status` | Get upload progress |
| POST | `/api/upload/{id}/complete` | Complete upload |
| DELETE | `/api/upload/{id}/abort` | Abort upload |

### File Access
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/file/{linkId}` | Get file metadata |
| POST | `/api/file/{linkId}/auth` | Authenticate with password |
| GET | `/api/file/{linkId}/download` | Download file (302 redirect) |
| DELETE | `/api/file/{linkId}` | Revoke link (requires owner token) |

## Deployment

Push to `main` triggers GitHub Actions:
1. Run tests (`mvn test`)
2. Build & push Docker image to `ghcr.io`
3. Deploy to Fly.io

## License

MIT
