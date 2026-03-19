package com.sansend.repository;

import com.sansend.entity.DownloadEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface DownloadEventRepository extends JpaRepository<DownloadEvent, Long> {
}
