import { useState, useEffect } from 'react';

export interface HistoryItem {
    id: string;
    fileName: string;
    fileSize: number;
    type: 'p2p' | 'cloud';
    role: 'sender' | 'receiver';
    timestamp: number;
    status: 'success' | 'failed';
}

export function useHistory() {
    const [history, setHistory] = useState<HistoryItem[]>([]);

    useEffect(() => {
        const stored = localStorage.getItem('sansend_history');
        if (stored) {
            try {
                setHistory(JSON.parse(stored));
            } catch (e) {
                console.error("Failed to parse history", e);
            }
        }
    }, []);

    const addToHistory = (item: Omit<HistoryItem, 'timestamp'>) => {
        const newItem: HistoryItem = { ...item, timestamp: Date.now() };
        const updated = [newItem, ...history].slice(0, 20); // Keep last 20
        setHistory(updated);
        localStorage.setItem('sansend_history', JSON.stringify(updated));
    };

    const clearHistory = () => {
        setHistory([]);
        localStorage.removeItem('sansend_history');
    };

    return { history, addToHistory, clearHistory };
}
