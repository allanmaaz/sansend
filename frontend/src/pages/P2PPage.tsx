import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { formatBytes, formatDuration, formatSpeed } from '../utils';
import { useHistory } from '../hooks/useHistory';

const CHUNK_SIZE = 256 * 1024; // 256KB
const MAX_BUFFER_AMOUNT = 8 * 1024 * 1024;
const BUFFER_LOW_THRESHOLD = 1024 * 1024;

type P2PRole = 'sender' | 'receiver' | null;
type P2PState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'pending_metadata' | 'transferring' | 'complete' | 'error';
type P2PView = 'choice' | 'send' | 'receive' | 'transfer';

export default function P2PPage() {
    const { roomId: urlRoomId } = useParams();
    const navigate = useNavigate();

    const [view, setView] = useState<P2PView>(urlRoomId ? 'transfer' : 'choice');
    const [role, setRole] = useState<P2PRole>(urlRoomId ? 'receiver' : null);
    const [roomId, setRoomId] = useState(urlRoomId || '');
    const [status, setStatus] = useState<P2PState>(urlRoomId ? 'waiting' : 'idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [vibe, setVibe] = useState<'default' | 'neon' | 'onyx'>('default');
    const [showHistory, setShowHistory] = useState(false);

    const { history, addToHistory } = useHistory();

    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState(0);
    const [speed, setSpeed] = useState(0);
    const [eta, setEta] = useState(0);

    const [incomingFileName, setIncomingFileName] = useState('');
    const [incomingFileSize, setIncomingFileSize] = useState(0);
    const incomingFileNameRef = useRef('');
    const incomingFileSizeRef = useRef(0);

    useEffect(() => {
        incomingFileNameRef.current = incomingFileName;
        incomingFileSizeRef.current = incomingFileSize;
    }, [incomingFileName, incomingFileSize]);

    const wsRef = useRef<WebSocket | null>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const dcRef = useRef<RTCDataChannel | null>(null);
    const roomIdRef = useRef(roomId);
    const statusRef = useRef(status);
    const metaIntervalRef = useRef<any>(null);

    const setStatusWithRef = (s: P2PState) => {
        statusRef.current = s;
        setStatus(s);
    };

    useEffect(() => {
        roomIdRef.current = roomId;
    }, [roomId]);

    const offsetRef = useRef(0);
    const lastTimeRef = useRef(Date.now());
    const lastBytesRef = useRef(0);
    const abortRef = useRef(false);

    const fileHandleRef = useRef<any>(null);
    const writableStreamRef = useRef<any>(null);
    const receiverBufferRef = useRef<ArrayBuffer[]>([]);

    useEffect(() => {
        document.documentElement.setAttribute('data-vibe', vibe);
    }, [vibe]);

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
        if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
        if (dcRef.current) { dcRef.current.close(); dcRef.current = null; }
        if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
        if (metaIntervalRef.current) { clearInterval(metaIntervalRef.current); metaIntervalRef.current = null; }
        try { if (writableStreamRef.current) writableStreamRef.current.close(); } catch { }
    };

    const getWsUrl = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const apiUrl = import.meta.env.VITE_API_URL || '';
        if (apiUrl.startsWith('http')) {
            return apiUrl.replace('http', 'ws') + '/ws/signaling';
        }
        const host = import.meta.env.PROD ? 'sansend.onrender.com' : 'localhost:8080';
        return `${protocol}//${host}/api/ws/signaling`;
    };

    const connectWebSocket = useCallback((id: string, isSender: boolean) => {
        try {
            const url = getWsUrl();
            const ws = new WebSocket(url);
            wsRef.current = ws;

            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'join', roomId: id }));
                setStatusWithRef('waiting');
            };

            ws.onmessage = async (e) => {
                const data = JSON.parse(e.data);
                if (data.type === 'error') {
                    setErrorMsg(data.message);
                    setStatusWithRef('error');
                    cleanup();
                } else if (data.type === 'peer-joined') {
                    if (isSender) initiateWebRTC();
                } else if (data.type === 'peer-disconnected') {
                    if (statusRef.current !== 'complete') {
                        setErrorMsg('Peer disconnected.');
                        setStatusWithRef('error');
                        cleanup();
                    }
                } else if (data.type === 'offer' && !isSender) {
                    await handleOffer(data.sdp);
                } else if (data.type === 'answer' && isSender) {
                    await handleAnswer(data.sdp);
                } else if (data.type === 'candidate') {
                    handleCandidate(data.candidate);
                }
            };

            ws.onerror = () => {
                setErrorMsg('WebSocket connection failed.');
                setStatus('error');
            };
        } catch (err) {
            setErrorMsg("Connection error.");
            setStatus('error');
        }
    }, []); // status removed from deps to prevent loop

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
                    roomId: roomIdRef.current
                }));
            }
        };
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                if (statusRef.current !== 'complete' && !abortRef.current) {
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
        const dc = pc.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
        dc.binaryType = 'arraybuffer';
        setupDataChannelSender(dc);
        dcRef.current = dc;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsRef.current?.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription, roomId: roomIdRef.current }));
    };

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        setStatus('connecting');
        const pc = setupPeerConnection();
        const dc = pc.createDataChannel('fileTransfer', { negotiated: true, id: 0 });
        dc.binaryType = 'arraybuffer';
        setupDataChannelReceiver(dc);
        dcRef.current = dc;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsRef.current?.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription, roomId: roomIdRef.current }));
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

    const createRoom = () => {
        if (!file) { setErrorMsg("Select a file first."); return; }
        const newId = Math.random().toString(36).substring(2, 8).toUpperCase();
        setRoomId(newId);
        setRole('sender');
        setView('transfer');
        connectWebSocket(newId, true);
    };

    const joinRoom = (id: string) => {
        if (!id) { setErrorMsg("Enter a valid room code."); return; }
        const cleanId = id.trim().toUpperCase();
        setRoomId(cleanId);
        setRole('receiver');
        setView('transfer');
        setStatusWithRef('waiting');
        connectWebSocket(cleanId, false);
    };

    const setupDataChannelSender = (dc: RTCDataChannel) => {
        dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
        dc.onopen = () => {
            console.log("DataChannel sender open");
            setStatus('connected');

            // Heartbeat: keep sending meta until acked
            if (metaIntervalRef.current) clearInterval(metaIntervalRef.current);
            const sendMeta = () => {
                if (statusRef.current === 'connected' && dc.readyState === 'open') {
                    console.log("Sending meta heartbeat...");
                    dc.send(JSON.stringify({ type: 'meta', name: file!.name, size: file!.size }));
                }
            };
            sendMeta();
            metaIntervalRef.current = setInterval(sendMeta, 2000);
        };
        dc.onbufferedamountlow = () => {
            if (statusRef.current === 'transferring' && !abortRef.current) sendFileChunks(dc);
        };
        dc.onmessage = (e) => {
            console.log("Sender dc message:", e.data);
            if (e.data === 'meta-ack') {
                console.log("Meta ACK received. Starting stream...");
                if (metaIntervalRef.current) { clearInterval(metaIntervalRef.current); metaIntervalRef.current = null; }
                setStatusWithRef('transferring');
                lastTimeRef.current = Date.now();
                lastBytesRef.current = 0;
                offsetRef.current = 0;
                sendFileChunks(dc);
            }
        };
    };

    const sendFileChunks = async (dc: RTCDataChannel) => {
        if (abortRef.current || !file || statusRef.current === 'complete') return;
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
                setStatus('error'); cleanup(); return;
            }
        }
        if (offsetRef.current >= file.size) {
            dc.send(JSON.stringify({ type: 'done' }));
            setStatus('complete');
            addToHistory({
                id: roomIdRef.current,
                fileName: file.name,
                fileSize: file.size,
                type: 'p2p',
                role: 'sender',
                status: 'success'
            });
        }
    };

    const setupDataChannelReceiver = (dc: RTCDataChannel) => {
        dc.onopen = () => {
            console.log("DataChannel receiver open");
            setStatus('connected');
        };
        dc.onmessage = async (e) => {
            console.log("Receiver dc message arrived:", typeof e.data);
            if (abortRef.current) return;
            if (typeof e.data === 'string') {
                try {
                    const msg = JSON.parse(e.data);
                    if (msg.type === 'meta') {
                        setIncomingFileName(msg.name);
                        setIncomingFileSize(msg.size);
                        incomingFileNameRef.current = msg.name;
                        incomingFileSizeRef.current = msg.size;
                        setStatusWithRef('pending_metadata');
                    } else if (msg.type === 'done') {
                        if (writableStreamRef.current) { await writableStreamRef.current.close(); }
                        else {
                            const blob = new Blob(receiverBufferRef.current);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = incomingFileNameRef.current; a.click();
                            URL.revokeObjectURL(url);
                        }
                        setStatus('complete'); cleanup();
                        addToHistory({
                            id: roomIdRef.current,
                            fileName: incomingFileNameRef.current,
                            fileSize: incomingFileSizeRef.current,
                            type: 'p2p',
                            role: 'receiver',
                            status: 'success'
                        });
                    }
                } catch (err) { }
            } else {
                if (writableStreamRef.current) { await writableStreamRef.current.write(e.data); }
                else { receiverBufferRef.current.push(e.data); }
                offsetRef.current += e.data.byteLength;
                updateProgress(offsetRef.current, incomingFileSizeRef.current);
            }
        };
    };

    const acceptTransfer = async () => {
        if (!dcRef.current) return;
        try {
            if ('showSaveFilePicker' in window) {
                fileHandleRef.current = await (window as any).showSaveFilePicker({ suggestedName: incomingFileNameRef.current });
                writableStreamRef.current = await fileHandleRef.current.createWritable();
            } else {
                receiverBufferRef.current = [];
            }
            setStatusWithRef('transferring');
            lastTimeRef.current = Date.now();
            lastBytesRef.current = 0;
            offsetRef.current = 0;
            dcRef.current.send('meta-ack');
        } catch (err) {
            setErrorMsg("Failed to start save. Did you cancel the dialog?");
            setStatusWithRef('error');
        }
    };

    const updateProgress = (loaded: number, total: number) => {
        const now = Date.now();
        if (now - lastTimeRef.current > 500) {
            const currentSpeed = (loaded - lastBytesRef.current) / ((now - lastTimeRef.current) / 1000);
            setSpeed(currentSpeed);
            setEta((total - loaded) / currentSpeed);
            lastBytesRef.current = loaded;
            lastTimeRef.current = now;
        }
        setProgress((loaded / total) * 100);
    };

    const shareUrl = `${window.location.origin}/p2p/${roomId}`;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 relative z-10 transition-all duration-700">
            {/* Top Bar Actions */}
            <div className="fixed top-6 left-6 flex gap-4">
                <a href="/" className="text-white/60 title-genz font-bold text-xl hover:text-white transition-all backdrop-blur-sm px-4 py-2 rounded-full border border-white/5 bg-white/5">
                    ← cloud.
                </a>
            </div>

            <div className="fixed top-6 right-6 flex items-center gap-6">
                <div className="flex gap-2">
                    <button onClick={() => setVibe('default')} className="vibe-dot bg-[#EFD2B0]" title="Default"></button>
                    <button onClick={() => setVibe('neon')} className="vibe-dot bg-[#00ffcc]" title="Neon"></button>
                    <button onClick={() => setVibe('onyx')} className="vibe-dot bg-white" title="Onyx"></button>
                </div>
                <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="text-white/60 hover:text-white transition-colors"
                    title="History"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </button>
            </div>

            {/* History Sidebar */}
            <div className={`history-sidebar ${showHistory ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-xl font-bold title-genz">History</h3>
                    <button onClick={() => setShowHistory(false)} className="text-slate-500 hover:text-white">✕</button>
                </div>
                <div className="overflow-y-auto h-[calc(100%-100px)]">
                    {history.length === 0 ? (
                        <p className="text-slate-500 text-center py-10 italic">No transfers yet.</p>
                    ) : (
                        history.map((item, idx) => (
                            <div key={idx} className="history-item">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-sm font-bold truncate max-w-[150px]">{item.fileName}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${item.type === 'p2p' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                                        {item.type}
                                    </span>
                                </div>
                                <div className="flex justify-between text-[11px] text-slate-500">
                                    <span>{formatBytes(item.fileSize)}</span>
                                    <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="text-center mb-10 relative">
                <h1 className="text-6xl md:text-8xl font-sans tracking-tighter title-genz mb-2 drop-shadow-2xl text-[#EFD2B0] animate-float">
                    p2p.
                </h1>
                <p className="text-slate-300/60 text-lg md:text-xl font-medium tracking-[0.2em] uppercase">
                    infinite stream
                </p>
            </div>

            <div className="w-full max-w-4xl">
                {/* CHOICE VIEW */}
                {view === 'choice' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 duration-700">
                        <div
                            onClick={() => setView('send')}
                            className="glass-card p-10 cursor-pointer group hover:border-[#EFD2B0]/40 transition-all text-center flex flex-col items-center"
                        >
                            <div className="w-20 h-20 bg-[#EFD2B0]/10 rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                                <svg className="w-10 h-10 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold title-genz mb-3">send file.</h2>
                            <p className="text-slate-400 font-medium">Host a room and stream massive data directly to anyone.</p>
                        </div>

                        <div
                            onClick={() => setView('receive')}
                            className="glass-card p-10 cursor-pointer group hover:border-[#408A71]/40 transition-all text-center flex flex-col items-center"
                        >
                            <div className="w-20 h-20 bg-[#408A71]/10 rounded-3xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500">
                                <svg className="w-10 h-10 text-[#408A71]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold title-genz mb-3">receive file.</h2>
                            <p className="text-slate-400 font-medium">Enter a code or scan to receive an infinite stream.</p>
                        </div>
                    </div>
                )}

                {/* SEND VIEW */}
                {view === 'send' && (
                    <div className="max-w-xl mx-auto glass-card p-8 animate-in fade-in zoom-in duration-500">
                        <h2 className="text-3xl font-bold title-genz mb-6 text-center">host transfer.</h2>
                        <div className="mb-8">
                            <label className="block text-sm text-slate-400 mb-4 font-medium uppercase tracking-widest text-center">Drag or Select Massive File</label>
                            <div className="drop-zone p-10 flex flex-col items-center justify-center relative overflow-hidden group">
                                <input
                                    type="file"
                                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                />
                                <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                    <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <p className="text-white font-medium text-lg truncate max-w-full px-4">
                                    {file ? file.name : 'choose a file...'}
                                </p>
                                {file && <p className="text-slate-500 text-sm mt-2">{formatBytes(file.size)}</p>}
                            </div>
                        </div>
                        <button
                            onClick={createRoom}
                            disabled={!file}
                            className={`w-full py-4 rounded-2xl font-bold text-xl transition-all shadow-2xl ${file ? 'btn-genz' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                        >
                            start hosting.
                        </button>
                        <button onClick={() => setView('choice')} className="mt-6 text-slate-500 hover:text-white text-sm mx-auto block transition-colors uppercase tracking-widest">Back</button>
                        {errorMsg && <p className="text-red-400 mt-6 text-center font-medium">{errorMsg}</p>}
                    </div>
                )}

                {/* RECEIVE VIEW */}
                {view === 'receive' && (
                    <div className="max-w-xl mx-auto glass-card p-8 animate-in fade-in zoom-in duration-500">
                        <h2 className="text-3xl font-bold title-genz mb-6 text-center">join transfer.</h2>
                        <div className="mb-8 text-center">
                            <label className="block text-sm text-slate-400 mb-4 font-medium uppercase tracking-widest">Enter 6-Digit Room Code</label>
                            <input
                                type="text"
                                placeholder="e.g. A1B2C3"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                                className="w-full bg-black/40 border-2 border-white/5 rounded-2xl p-5 text-center text-4xl font-mono tracking-[0.3em] focus:border-[#408A71]/50 transition-all text-[#EFD2B0]"
                                maxLength={6}
                            />
                        </div>
                        <button
                            onClick={() => joinRoom(roomId)}
                            disabled={!roomId || roomId.length < 4}
                            className={`w-full py-4 rounded-2xl font-bold text-xl transition-all shadow-2xl ${roomId.length >= 4 ? 'btn-genz' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
                        >
                            connect to host.
                        </button>
                        <div className="mt-8 pt-8 border-t border-white/5 flex flex-col items-center">
                            <p className="text-slate-500 text-sm mb-4 uppercase tracking-widest">or scan the code</p>
                            <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center cursor-not-allowed opacity-50">
                                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                        </div>
                        <button onClick={() => setView('choice')} className="mt-6 text-slate-500 hover:text-white text-sm mx-auto block transition-colors uppercase tracking-widest">Back</button>
                        {errorMsg && <p className="text-red-400 mt-6 text-center font-medium">{errorMsg}</p>}
                    </div>
                )}

                {/* TRANSFER VIEW */}
                {view === 'transfer' && (
                    <div className="max-w-xl mx-auto glass-card p-8 min-h-[400px] flex flex-col justify-center animate-in zoom-in duration-500">
                        {status === 'waiting' && role === 'sender' && (
                            <div className="text-center">
                                <div className="w-16 h-16 rounded-full border-4 border-t-[#408A71] border-slate-700 animate-spin mx-auto mb-6"></div>
                                <h2 className="text-3xl title-genz font-bold mb-2">ready to beam.</h2>
                                <p className="text-slate-400 mb-8 font-medium italic">"Stay on this page. Sending is about to start."</p>

                                <div className="bg-black/40 rounded-2xl p-1 mb-8 border border-white/5 group">
                                    <div className="flex items-center gap-3 p-3">
                                        <div className="flex-1 text-center font-mono text-3xl tracking-[0.2em] text-[#EFD2B0] pl-8">
                                            {roomId}
                                        </div>
                                        <button
                                            onClick={() => navigator.clipboard.writeText(shareUrl)}
                                            className="bg-white/5 hover:bg-white/10 p-3 rounded-xl transition-colors"
                                            title="Copy link"
                                        >
                                            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>

                                <div className="flex justify-center mb-8">
                                    <div className="p-4 bg-white rounded-[2rem] shadow-[0_0_50px_rgba(255,255,255,0.1)]">
                                        <QRCodeSVG value={shareUrl} size={150} fgColor="#121416" />
                                    </div>
                                </div>
                                <button onClick={() => { cleanup(); setView('choice'); setStatus('idle'); }} className="text-slate-500 hover:text-white text-sm uppercase tracking-widest pt-4 transition-colors">Abort Session</button>
                            </div>
                        )}

                        {status === 'waiting' && role === 'receiver' && (
                            <div className="text-center">
                                <div className="w-16 h-16 rounded-full border-4 border-t-[#EFD2B0] border-slate-700 animate-spin mx-auto mb-6"></div>
                                <h2 className="text-3xl title-genz font-bold mb-2">seeking tunnel.</h2>
                                <p className="text-slate-400 mb-8 font-medium">Connecting to room <span className="text-[#EFD2B0] font-bold">{roomId}</span>...</p>
                                <button onClick={() => { cleanup(); setView('choice'); setStatus('idle'); }} className="text-slate-500 hover:text-white text-sm uppercase tracking-widest pt-4">Cancel</button>
                            </div>
                        )}

                        {status === 'pending_metadata' && (
                            <div className="text-center py-6 animate-in zoom-in duration-500">
                                <div className="w-24 h-24 mx-auto bg-[#EFD2B0]/20 rounded-full flex items-center justify-center mb-8">
                                    <svg className="w-12 h-12 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                </div>
                                <h2 className="text-3xl title-genz font-bold mb-2">incoming.</h2>
                                <p className="text-slate-400 font-medium mb-1">
                                    <span className="text-white">{incomingFileName}</span>
                                </p>
                                <p className="text-slate-500 text-sm mb-8">{formatBytes(incomingFileSize)}</p>

                                <button
                                    onClick={acceptTransfer}
                                    className="w-full btn-genz py-4 text-xl font-bold rounded-2xl shadow-xl hover:scale-105 transition-transform"
                                >
                                    accept & save.
                                </button>
                                <button onClick={() => { cleanup(); setView('choice'); setStatus('idle'); }} className="mt-6 text-slate-500 hover:text-white text-sm uppercase tracking-widest transition-colors font-bold">Reject</button>
                            </div>
                        )}

                        {status === 'connecting' && (
                            <div className="text-center py-8">
                                <div className="w-24 h-24 mx-auto bg-[#EFD2B0]/10 rounded-full flex items-center justify-center mb-8 animate-pulse pulse-border border">
                                    <svg className="w-12 h-12 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7h12m0 0l-4-4m4 4l-4 4m-8 6H4m0 0l4 4m-4-4l4-4" />
                                    </svg>
                                </div>
                                <h2 className="text-3xl title-genz font-bold mb-2">threading.</h2>
                                <p className="text-slate-400 font-medium tracking-wide">negotiating p2p data stream tunnel...</p>
                            </div>
                        )}

                        {status === 'connected' && (
                            <div className="text-center py-8">
                                <div className="w-24 h-24 mx-auto bg-[#EFD2B0]/20 rounded-full flex items-center justify-center mb-8">
                                    <svg className="w-12 h-12 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                </div>
                                <h2 className="text-4xl title-genz font-bold mb-2">alive.</h2>
                                <p className="text-slate-400 font-medium mb-6">
                                    {role === 'sender' ? 'waiting for peer to accept chunk stream...' : 'incoming stream! choose save path now.'}
                                </p>
                                {role === 'sender' && (
                                    <button
                                        onClick={() => {
                                            if (dcRef.current) {
                                                console.log("Forcing start...");
                                                if (metaIntervalRef.current) { clearInterval(metaIntervalRef.current); metaIntervalRef.current = null; }
                                                setStatusWithRef('transferring');
                                                lastTimeRef.current = Date.now();
                                                lastBytesRef.current = 0;
                                                offsetRef.current = 0;
                                                sendFileChunks(dcRef.current);
                                            }
                                        }}
                                        className="text-[10px] text-slate-600 hover:text-slate-400 uppercase tracking-widest font-bold border border-slate-800 rounded-lg px-3 py-1 mt-4 transition-colors"
                                    >
                                        Force Start if stuck
                                    </button>
                                )}
                            </div>
                        )}

                        {status === 'transferring' && (
                            <div className="animate-in fade-in duration-700">
                                <div className="flex justify-between items-end mb-8">
                                    <div>
                                        <h2 className="text-5xl title-genz font-bold pb-2">beaming.</h2>
                                        <p className="text-slate-400 text-sm mt-1 max-w-[250px] truncate font-medium">
                                            {role === 'sender' ? file?.name : incomingFileName}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[#EFD2B0] font-mono font-bold text-3xl">{progress.toFixed(1)}%</p>
                                        <p className="text-slate-400 text-sm font-mono mt-1">{formatSpeed(speed)}</p>
                                    </div>
                                </div>

                                <div className="progress-bar-bg h-6 mb-6 overflow-hidden relative shadow-inner">
                                    <div className="progress-bar-fill h-full relative" style={{ width: `${Math.min(progress, 100)}%` }}>
                                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                                    </div>
                                </div>

                                <div className="flex justify-between text-slate-500 text-xs font-mono uppercase tracking-[0.2em]">
                                    <span>{formatBytes(role === 'sender' ? file!.size : incomingFileSize)} total</span>
                                    <span>timeLeft: {formatDuration(eta)}</span>
                                </div>

                                <button onClick={cleanup} className="mt-12 text-slate-500 hover:text-red-400 text-sm mx-auto block transition-colors uppercase tracking-widest font-bold">abort stream</button>
                            </div>
                        )}

                        {status === 'complete' && (
                            <div className="text-center py-6 animate-in zoom-in duration-500">
                                <div className="w-24 h-24 mx-auto bg-[#408A71]/20 rounded-full flex items-center justify-center mb-8">
                                    <svg className="w-12 h-12 text-[#408A71]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <h2 className="text-4xl font-bold title-genz mb-3">landed.</h2>
                                <p className="text-slate-400 mb-10 font-medium text-lg">Transfer completed successfully via P2P.</p>
                                <button onClick={() => navigate('/')} className="w-full btn-genz py-5 text-xl font-bold rounded-2xl">back to cloud mode</button>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="text-center py-6">
                                <div className="w-24 h-24 mx-auto bg-red-500/10 rounded-full flex items-center justify-center mb-8">
                                    <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </div>
                                <h2 className="text-3xl font-bold text-red-400 mb-2">crashed.</h2>
                                <p className="text-slate-400 mb-10 text-lg">{errorMsg || 'Connection dropped.'}</p>
                                <button onClick={() => window.location.reload()} className="px-10 py-4 border-2 border-slate-700 rounded-2xl text-slate-300 hover:bg-slate-800 transition-all font-bold uppercase tracking-widest">
                                    reboot
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
