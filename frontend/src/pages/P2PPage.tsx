import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { formatBytes, formatDuration, formatSpeed } from '../utils';

// Premium animations
const shimmerStyle = `
@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}
.animate-shimmer {
    animation: shimmer 1.5s infinite linear;
}
`;

const CHUNK_SIZE = 256 * 1024; // 256KB for much higher throughput
const MAX_BUFFER_AMOUNT = 8 * 1024 * 1024; // 8MB buffer
const BUFFER_LOW_THRESHOLD = 1024 * 1024; // 1MB low threshold trigger

type P2PRole = 'sender' | 'receiver' | null;
type P2PState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'transferring' | 'complete' | 'error';

export default function P2PPage() {
    const { roomId: urlRoomId } = useParams();
    const navigate = useNavigate();

    const [role, setRole] = useState<P2PRole>(urlRoomId ? 'receiver' : null);
    const [roomId, setRoomId] = useState(urlRoomId || '');
    const [status, setStatus] = useState<P2PState>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [speed, setSpeed] = useState(0);
    const [eta, setEta] = useState(0);

    // Receiver specific
    const [incomingFileName, setIncomingFileName] = useState('');
    const [incomingFileSize, setIncomingFileSize] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);

    // File transfer state
    const offsetRef = useRef(0);
    const lastTimeRef = useRef(Date.now());
    const lastBytesRef = useRef(0);
    const abortRef = useRef(false);

    // Receiver streams
    const fileHandleRef = useRef<any>(null);
    const writableStreamRef = useRef<any>(null);

    useEffect(() => {
        if (urlRoomId && role === 'receiver') {
            joinRoom(urlRoomId);
        }
        return () => {
            cleanup();
        };
    }, []);

    const cleanup = () => {
        abortRef.current = true;
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        if (dcRef.current) {
            dcRef.current.close();
            dcRef.current = null;
        }
        if (pcRef.current) {
            pcRef.current.close();
            pcRef.current = null;
        }
        try {
            if (writableStreamRef.current) writableStreamRef.current.close();
        } catch { }
    };

    const getWsUrl = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const apiUrl = import.meta.env.VITE_API_URL || '';
        if (apiUrl.startsWith('http')) {
            return apiUrl.replace('http', 'ws') + '/ws/signaling';
        }
        // Fallback to current host if relative or not set
        const host = window.location.host;
        const backendHost = import.meta.env.PROD ? 'sansend.onrender.com' : 'localhost:8080';
        return `${protocol}//${backendHost}/api/ws/signaling`;
    };

    const connectWebSocket = useCallback((id: string, isSender: boolean) => {
        const ws = new WebSocket(getWsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'join', roomId: id }));
            setStatus('waiting');
        };

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'error') {
                setErrorMsg(data.message);
                setStatus('error');
                cleanup();
            } else if (data.type === 'peer-joined' && isSender) {
                // Receiver joined, initiate WebRTC
                initiateWebRTC();
            } else if (data.type === 'peer-disconnected') {
                setErrorMsg('Peer disconnected.');
                setStatus('error');
                cleanup();
            } else if (data.type === 'offer' && !isSender) {
                await handleOffer(data.sdp);
            } else if (data.type === 'answer' && isSender) {
                await handleAnswer(data.sdp);
            } else if (data.type === 'candidate') {
                handleCandidate(data.candidate);
            }
        };

        ws.onerror = () => {
            setErrorMsg('WebSocket connection error.');
            setStatus('error');
        };
    }, []);

    const setupPeerConnection = () => {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });
        pcRef.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate && wsRef.current) {
                wsRef.current.send(JSON.stringify({
                    type: 'candidate',
                    candidate: event.candidate,
                    roomId
                }));
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                if (status !== 'complete') {
                    setErrorMsg('P2P connection lost.');
                    setStatus('error');
                    cleanup();
                }
            }
        };

        return pc;
    };

    const initiateWebRTC = async () => {
        setStatus('connecting');
        const pc = setupPeerConnection();

        // Create Data Channel
        const dc = pc.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
        dc.binaryType = 'arraybuffer';
        setupDataChannelSender(dc);
        dcRef.current = dc;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        wsRef.current?.send(JSON.stringify({
            type: 'offer',
            sdp: pc.localDescription,
            roomId
        }));
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        setStatus('connecting');
        const pc = setupPeerConnection();

        // Receiver Data Channel
        const dc = pc.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
        dc.binaryType = 'arraybuffer';
        setupDataChannelReceiver(dc);
        dcRef.current = dc;

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        wsRef.current?.send(JSON.stringify({
            type: 'answer',
            sdp: pc.localDescription,
            roomId
        }));
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
        if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        }
    };

    const handleCandidate = (candidate: RTCIceCandidateInit) => {
        if (pcRef.current) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
        }
    };

    // --- SENDER LOGIC ---
    const createRoom = () => {
        if (!file) {
            setErrorMsg("Select a file first.");
            return;
        }
        const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setRoomId(newId);
        setRole('sender');
        connectWebSocket(newId, true);
    };

    const setupDataChannelSender = (dc: RTCDataChannel) => {
        dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
        dc.onopen = () => {
            handlePeerConnected();
            // Send metadata first
            dc.send(JSON.stringify({
                type: 'meta',
                name: file!.name,
                size: file!.size
            }));
        };

        dc.onbufferedamountlow = () => {
            if (status === 'transferring' && !abortRef.current) {
                sendFileChunks(dc);
            }
        };

        dc.onmessage = (e) => {
            if (e.data === 'meta-ack') {
                setStatus('transferring');
                lastTimeRef.current = Date.now();
                lastBytesRef.current = 0;
                offsetRef.current = 0;
                sendFileChunks(dc);
            }
        };
    };

    const handlePeerConnected = () => {
        if (role === 'sender') {
            setStatus('connected'); // Shows as "Ready! waiting for recipient to accept"
        } else {
            setStatus('connected'); // Shows as "Incoming transfer! click download to start"
        }
    };

    const sendFileChunks = async (dc: RTCDataChannel) => {
        if (abortRef.current || !file || status === 'complete') return;

        // Fill buffer up to MAX_BUFFER_AMOUNT
        while (offsetRef.current < file.size && dc.bufferedAmount < MAX_BUFFER_AMOUNT) {
            if (abortRef.current) break;

            const end = Math.min(offsetRef.current + CHUNK_SIZE, file.size);
            const chunk = file.slice(offsetRef.current, end);

            try {
                const buffer = await chunk.arrayBuffer();
                dc.send(buffer);
                offsetRef.current = end;
                updateProgress(offsetRef.current, file.size);
            } catch (err) {
                console.error("DataChannel send error", err);
                setErrorMsg("Connection dropped during transfer.");
                setStatus('error');
                cleanup();
                return;
            }
        }

        if (offsetRef.current >= file.size && status !== 'complete') {
            dc.send(JSON.stringify({ type: 'done' }));
            setStatus('complete');
        }
    };

    // --- RECEIVER LOGIC ---
    const joinRoom = (id: string) => {
        setRoomId(id);
        setRole('receiver');
        connectWebSocket(id, false);
    };

    const setupDataChannelReceiver = (dc: RTCDataChannel) => {
        dc.onopen = () => {
            handlePeerConnected();
        };

        dc.onmessage = async (e) => {
            if (abortRef.current) return;

            if (typeof e.data === 'string') {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'meta') {
                        setIncomingFileName(msg.name);
                        setIncomingFileSize(msg.size);
                        // Ask user where to save before acknowledging
                        try {
                            // Use File System Access API if available for unlimited sizes
                            if ('showSaveFilePicker' in window) {
                                fileHandleRef.current = await (window as any).showSaveFilePicker({
                                    suggestedName: msg.name
                                });
                                writableStreamRef.current = await fileHandleRef.current.createWritable();
                                setStatus('transferring');
                                lastTimeRef.current = Date.now();
                                lastBytesRef.current = 0;
                                offsetRef.current = 0;
                                dc.send('meta-ack');
                            } else {
                                // Fallback for browsers without File System API
                                setErrorMsg("Browser doesn't support massive direct-to-disk streams.");
                                setStatus('error');
                                cleanup();
                            }
                        } catch (err) {
                            setErrorMsg("Download cancelled by user.");
                            setStatus('error');
                            cleanup();
                        }
                    } else if (msg.type === 'done') {
                        if (writableStreamRef.current) {
                            await writableStreamRef.current.close();
                        }
                        setStatus('complete');
                        cleanup();
                    }
                } catch (err) { }
            } else {
                // Binary chunk
                if (writableStreamRef.current) {
                    await writableStreamRef.current.write(e.data);
                    offsetRef.current += e.data.byteLength;
                    updateProgress(offsetRef.current, incomingFileSize);
                }
            }
        };
    };

    const updateProgress = (loaded: number, total: number) => {
        const now = Date.now();
        if (now - lastTimeRef.current > 500) {
            const bytesSinceLast = loaded - lastBytesRef.current;
            const timeSinceLast = (now - lastTimeRef.current) / 1000;
            const currentSpeed = bytesSinceLast / timeSinceLast;

            setSpeed(currentSpeed);
            setEta((total - loaded) / currentSpeed);

            lastBytesRef.current = loaded;
            lastTimeRef.current = now;
        }
        setProgress((loaded / total) * 100);
    };

    const shareUrl = `${window.location.origin}/p2p/${roomId}`;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative z-10">
            <style>{shimmerStyle}</style>

            <div className="absolute top-6 left-6">
                <a href="/" className="text-white/60 title-genz font-bold text-xl hover:text-white transition-all backdrop-blur-sm px-4 py-2 rounded-full border border-white/5 bg-white/5">
                    ← cloud.
                </a>
            </div>

            <div className="text-center mb-10 relative">
                <h1 className="text-6xl md:text-8xl font-sans tracking-tighter title-genz mb-2 drop-shadow-2xl text-[#EFD2B0] animate-float">
                    p2p.
                </h1>
                <p className="text-slate-300/60 text-lg md:text-xl font-medium tracking-[0.2em] uppercase">
                    infinite stream
                </p>
            </div>

            <div className="w-full max-w-xl">
                <div className="glass-card p-8">
                    {status === 'idle' && !urlRoomId && (
                        <div>
                            <div className="mb-6">
                                <label className="block text-sm text-slate-300 mb-2 font-medium">Select Massive File (1TB+ Supported)</label>
                                <input
                                    type="file"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="w-full border border-slate-500/30 rounded-xl p-3 bg-dark-900/50 text-slate-200"
                                />
                            </div>
                            <button
                                onClick={createRoom}
                                disabled={!file}
                                className={`w-full py-4 rounded-xl font-bold text-lg transition-all ${file ? 'btn-genz shadow-lg hover:-translate-y-1' : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                    }`}
                            >
                                host transfer room.
                            </button>
                            {errorMsg && <p className="text-red-400 mt-4 text-center">{errorMsg}</p>}
                        </div>
                    )}

                    {status === 'idle' && urlRoomId && (
                        <div className="text-center">
                            <h2 className="text-2xl title-genz mb-4 font-bold">join room {urlRoomId}</h2>
                            <button
                                onClick={() => joinRoom(urlRoomId)}
                                className="w-full btn-genz py-4 text-lg font-bold"
                            >
                                connect & download.
                            </button>
                            {errorMsg && <p className="text-red-400 mt-4">{errorMsg}</p>}
                        </div>
                    )}

                    {status === 'waiting' && role === 'sender' && (
                        <div className="text-center">
                            <div className="w-16 h-16 rounded-full border-4 border-t-[#408A71] border-slate-700 animate-spin mx-auto mb-6"></div>
                            <h2 className="text-2xl title-genz font-bold mb-2">waiting for receiver...</h2>
                            <p className="text-slate-400 mb-6 font-medium">Share this link. Don't close this tab.</p>

                            <div className="bg-dark-900/50 rounded-xl p-3 flex items-center gap-2 mb-6">
                                <input type="text" readOnly value={shareUrl} className="flex-1 bg-transparent text-sm text-slate-300" />
                                <button
                                    onClick={() => navigator.clipboard.writeText(shareUrl)}
                                    className="px-4 py-2 hover:bg-slate-700 rounded-lg text-sm text-slate-200 font-medium transition-colors"
                                >
                                    Copy
                                </button>
                            </div>
                            <div className="flex justify-center mb-4">
                                <div className="p-3 bg-white rounded-xl">
                                    <QRCodeSVG value={shareUrl} size={130} fgColor="#1e1b4b" />
                                </div>
                            </div>

                            <button onClick={cleanup} className="text-slate-400 hover:text-white text-sm">Cancel Session</button>
                        </div>
                    )}

                    {status === 'connecting' && (
                        <div className="text-center py-8">
                            <h2 className="text-2xl title-genz font-bold mb-2 animate-pulse">negotiating p2p tunnel...</h2>
                            <p className="text-slate-400">establishing pure webrtc connection.</p>
                        </div>
                    )}

                    {status === 'connected' && (
                        <div className="text-center py-6">
                            <div className="w-20 h-20 mx-auto bg-[#EFD2B0]/20 rounded-full flex items-center justify-center mb-6 animate-pulse">
                                <svg className="w-10 h-10 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </div>
                            <h2 className="text-3xl title-genz font-bold mb-2">tunnel ready.</h2>
                            <p className="text-slate-400 font-medium tracking-wide">
                                {role === 'sender' ? 'waiting for peer to accept file...' : 'incoming transfer! click join above.'}
                            </p>
                            {role === 'receiver' && (
                                <p className="text-xs text-[#EFD2B0] mt-4 opacity-70">choose where to save the file on your device.</p>
                            )}
                        </div>
                    )}

                    {status === 'transferring' && (
                        <div>
                            <div className="flex justify-between items-end mb-4">
                                <div>
                                    <h2 className="text-3xl title-genz font-bold pb-1">streaming.</h2>
                                    <p className="text-slate-300 text-sm opacity-80 mt-1 max-w-[200px] truncate">
                                        {role === 'sender' ? file?.name : incomingFileName}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="text-white font-mono font-bold text-lg">{progress.toFixed(1)}%</p>
                                    <p className="text-slate-400 text-sm font-mono mt-0.5">{formatSpeed(speed)}</p>
                                </div>
                            </div>

                            <div className="progress-bar-bg h-4 mb-3 overflow-hidden relative">
                                <div className="progress-bar-fill h-full relative" style={{ width: `${Math.min(progress, 100)}%` }}>
                                    {status === 'transferring' && (
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-between text-slate-400 text-sm font-mono">
                                <span>{formatBytes(role === 'sender' ? file!.size : incomingFileSize)}</span>
                                <span>ETA: {formatDuration(eta)}</span>
                            </div>

                            <button onClick={cleanup} className="mt-8 text-slate-500 hover:text-white text-sm mx-auto block transition-colors">
                                abort transfer
                            </button>
                        </div>
                    )}

                    {status === 'complete' && (
                        <div className="text-center py-6">
                            <div className="w-20 h-20 mx-auto bg-[#408A71]/20 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-[#408A71]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold title-genz mb-2">transfer complete.</h2>
                            <p className="text-slate-400 mb-8 font-medium">The P2P tunnel is now closed.</p>

                            <button onClick={() => navigate('/')} className="w-full btn-genz py-4 text-lg font-bold">
                                back to cloud mode
                            </button>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="text-center py-6">
                            <div className="w-20 h-20 mx-auto bg-red-500/10 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-red-400 mb-2">connection failed.</h2>
                            <p className="text-slate-400 mb-8">{errorMsg}</p>

                            <button onClick={() => window.location.reload()} className="px-6 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors">
                                Try Again
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
