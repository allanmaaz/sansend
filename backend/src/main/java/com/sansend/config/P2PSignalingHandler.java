package com.sansend.config;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

@Slf4j
@Component
public class P2PSignalingHandler extends TextWebSocketHandler {

    private final Map<String, CopyOnWriteArrayList<WebSocketSession>> rooms = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("WebSocket connection established: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        JsonNode jsonNode = objectMapper.readTree(payload);

        if (!jsonNode.has("type") || !jsonNode.has("roomId")) {
            return;
        }

        String type = jsonNode.get("type").asText();
        String roomId = jsonNode.get("roomId").asText();

        CopyOnWriteArrayList<WebSocketSession> roomSessions = rooms.computeIfAbsent(roomId,
                k -> new CopyOnWriteArrayList<>());

        switch (type) {
            case "join":
                if (roomSessions.size() >= 2) {
                    session.sendMessage(new TextMessage("{\"type\":\"error\",\"message\":\"Room is full\"}"));
                    return;
                }
                if (!roomSessions.contains(session)) {
                    roomSessions.add(session);
                }
                broadcastToRoom(roomId, session, "{\"type\":\"peer-joined\"}");
                break;
            case "offer":
            case "answer":
            case "candidate":
                broadcastToRoom(roomId, session, payload);
                break;
            default:
                log.warn("Unknown message type: {}", type);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        log.info("WebSocket connection closed: {}", session.getId());
        rooms.forEach((roomId, sessions) -> {
            boolean removed = sessions.remove(session);
            if (removed && !sessions.isEmpty()) {
                try {
                    broadcastToRoom(roomId, session, "{\"type\":\"peer-disconnected\"}");
                } catch (Exception e) {
                    log.error("Error broadcasting disconnect", e);
                }
            }
            if (sessions.isEmpty()) {
                rooms.remove(roomId);
            }
        });
    }

    private void broadcastToRoom(String roomId, WebSocketSession senderSession, String message) throws Exception {
        CopyOnWriteArrayList<WebSocketSession> roomSessions = rooms.get(roomId);
        if (roomSessions == null)
            return;

        TextMessage textMessage = new TextMessage(message);
        for (WebSocketSession peerSession : roomSessions) {
            if (peerSession.isOpen() && !peerSession.getId().equals(senderSession.getId())) {
                peerSession.sendMessage(textMessage);
            }
        }
    }
}
