package com.sansend.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3AsyncClient;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

import software.amazon.awssdk.services.s3.S3Configuration;

import java.net.URI;

@Configuration
public class S3Config {

        @Value("${s3.endpoint}")
        private String endpoint;

        @Value("${s3.access-key}")
        private String accessKey;

        @Value("${s3.secret-key}")
        private String secretKey;

        @Value("${s3.region}")
        private String region;

        @Value("${s3.bucket}")
        private String bucket;

        @Bean
        public S3AsyncClient s3AsyncClient() {
                return S3AsyncClient.builder()
                                .endpointOverride(URI.create(endpoint))
                                .region(Region.of(region))
                                .credentialsProvider(StaticCredentialsProvider.create(
                                                AwsBasicCredentials.create(accessKey, secretKey)))
                                .forcePathStyle(true)
                                .build();
        }

        @Bean
        public S3Client s3Client() {
                return S3Client.builder()
                                .endpointOverride(URI.create(endpoint))
                                .region(Region.of(region))
                                .credentialsProvider(StaticCredentialsProvider.create(
                                                AwsBasicCredentials.create(accessKey, secretKey)))
                                .forcePathStyle(true)
                                .build();
        }

        @Bean
        public S3Presigner s3Presigner() {
                return S3Presigner.builder()
                                .endpointOverride(URI.create(endpoint))
                                .region(Region.of(region))
                                .credentialsProvider(StaticCredentialsProvider.create(
                                                AwsBasicCredentials.create(accessKey, secretKey)))
                                .serviceConfiguration(S3Configuration.builder()
                                                .pathStyleAccessEnabled(true)
                                                .build())
                                .build();
        }

        @Bean
        public String s3Bucket() {
                return bucket;
        }
}
