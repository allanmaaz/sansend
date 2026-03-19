# ============================================
# Stage 1: Build the JAR
# ============================================
FROM maven:3.9-eclipse-temurin-17 AS build

WORKDIR /app

# Copy POM first for dependency caching
COPY backend/pom.xml ./
RUN mvn dependency:go-offline -B

# Copy source and build
COPY backend/src ./src
RUN mvn package -DskipTests -B

# ============================================
# Stage 2: Runtime
# ============================================
FROM eclipse-temurin:17-jre-alpine

RUN addgroup -S sansend && adduser -S sansend -G sansend

WORKDIR /app

COPY --from=build /app/target/*.jar app.jar

RUN chown -R sansend:sansend /app
USER sansend

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -q --spider http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
