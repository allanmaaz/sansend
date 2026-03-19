package com.sansend.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class RateLimitService {

    private static final String KEY_PREFIX = "rate:upload_init:";

    private final StringRedisTemplate redisTemplate;

    public RateLimitService(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * Check if the given IP has exceeded the upload init rate limit.
     * 
     * @param ip            client IP address
     * @param maxRequests   maximum allowed requests in the window
     * @param windowSeconds time window in seconds
     * @return true if the request is allowed, false if rate limited
     */
    public boolean isAllowed(String ip, int maxRequests, long windowSeconds) {
        String key = KEY_PREFIX + ip;
        Long currentCount = redisTemplate.opsForValue().increment(key);

        if (currentCount != null && currentCount == 1) {
            redisTemplate.expire(key, Duration.ofSeconds(windowSeconds));
        }

        return currentCount != null && currentCount <= maxRequests;
    }
}
