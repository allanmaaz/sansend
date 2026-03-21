import { useState, useCallback, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
    initUpload,
    getPresignedUrl,
    confirmChunk,
    completeUpload,
    abortUpload,
    UploadInitRequest,
    UploadCompleteResponse,
} from '../api';
import { formatBytes, formatSpeed, formatDuration } from '../utils';

type UploadStage = 'idle' | 'uploading' | 'completing' | 'success' | 'error';

interface ChunkState {
    status: 'pending' | 'uploading' | 'done' | 'error';
}

export default function UploadPage() {
    const [file, setFile] = useState<File | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [stage, setStage] = useState<UploadStage>('idle');
    const [showSettings, setShowSettings] = useState(false);

    // Settings
    const [expiresIn, setExpiresIn] = useState('24h');
    const [maxDownloads, setMaxDownloads] = useState('');
    const [password, setPassword] = useState('');

    // Upload state
    const [progress, setProgress] = useState(0);
    const [speed, setSpeed] = useState(0);
    const [eta, setEta] = useState(0);
    const [chunks, setChunks] = useState<ChunkState[]>([]);
    const [error, setError] = useState('');
    const [result, setResult] = useState<UploadCompleteResponse | null>(null);
    const [ownerToken, setOwnerToken] = useState('');
    const [copied, setCopied] = useState(false);

    const abortRef = useRef(false);
    const uploadIdRef = useRef<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]);
    }, []);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) setFile(e.target.files[0]);
    };

    const startUpload = async () => {
        if (!file) return;
        abortRef.current = false;
        setStage('uploading');
        setError('');

        try {
            const request: UploadInitRequest = {
                fileName: file.name,
                fileSizeBytes: file.size,
                mimeType: file.type || 'application/octet-stream',
                expiresIn,
                maxDownloads: maxDownloads ? parseInt(maxDownloads) : undefined,
                password: password || undefined,
            };

            const initRes = await initUpload(request);
            uploadIdRef.current = initRes.uploadId;
            setOwnerToken(initRes.ownerToken);

            const totalChunks = initRes.totalChunks;
            const chunkSize = initRes.chunkSizeBytes;
            const chunkStates: ChunkState[] = Array.from({ length: totalChunks }, () => ({ status: 'pending' as const }));
            setChunks(chunkStates);

            let uploadedBytes = 0;
            const startTime = Date.now();
            const CONCURRENT = 10;

            // Upload chunks with concurrency
            const uploadChunk = async (chunkNum: number) => {
                if (abortRef.current) return;

                chunkStates[chunkNum - 1] = { status: 'uploading' };
                setChunks([...chunkStates]);

                const start = (chunkNum - 1) * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                const blob = file.slice(start, end);

                const presignRes = await getPresignedUrl(initRes.uploadId, chunkNum);

                const response = await fetch(presignRes.presignedUrl, {
                    method: 'PUT',
                    body: blob,
                });

                const etag = response.headers.get('ETag') || `"chunk-${chunkNum}"`;
                await confirmChunk(initRes.uploadId, chunkNum, etag);

                chunkStates[chunkNum - 1] = { status: 'done' };
                setChunks([...chunkStates]);

                uploadedBytes += (end - start);
                const elapsed = (Date.now() - startTime) / 1000;
                const currentSpeed = uploadedBytes / elapsed;
                const remaining = (file.size - uploadedBytes) / currentSpeed;

                setProgress((uploadedBytes / file.size) * 100);
                setSpeed(currentSpeed);
                setEta(remaining);
            };

            // Process chunks with a sliding window for maximum throughput
            let currentChunk = 0;
            const activeUploads = new Set<Promise<void>>();

            while (currentChunk < totalChunks || activeUploads.size > 0) {
                if (abortRef.current) break;

                while (activeUploads.size < CONCURRENT && currentChunk < totalChunks) {
                    currentChunk++;
                    const p = uploadChunk(currentChunk).finally(() => activeUploads.delete(p));
                    activeUploads.add(p);
                }

                if (activeUploads.size > 0) {
                    await Promise.race(activeUploads);
                }
            }

            if (abortRef.current) return;

            // Complete upload
            setStage('completing');
            const completeRes = await completeUpload(initRes.uploadId, request);
            setResult(completeRes);
            setStage('success');

        } catch (err: any) {
            if (!abortRef.current) {
                setError(err.response?.data?.message || err.message || 'Upload failed');
                setStage('error');
            }
        }
    };

    const handleAbort = async () => {
        abortRef.current = true;
        if (uploadIdRef.current) {
            try {
                await abortUpload(uploadIdRef.current);
            } catch { }
        }
        setStage('idle');
        setProgress(0);
        setChunks([]);
    };

    const handleCopyLink = () => {
        if (result) {
            const url = `${window.location.origin}/dl/${result.linkToken}`;
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleReset = () => {
        setFile(null);
        setStage('idle');
        setProgress(0);
        setChunks([]);
        setResult(null);
        setError('');
        setSpeed(0);
        setEta(0);
    };

    const shareUrl = result ? `${window.location.origin}/dl/${result.linkToken}` : '';

    // ---- RENDER ----
    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
            {/* Header */}
            <div className="text-center mb-10 relative z-10">
                <h1 className="text-6xl md:text-7xl font-sans tracking-tighter title-genz mb-4 drop-shadow-xl">
                    sansend.
                </h1>
                <p className="text-slate-300/80 text-lg md:text-xl font-medium tracking-wide">
                    drop your files. up to 50gb.
                </p>
            </div>

            <div className="w-full max-w-2xl">
                {/* ===== IDLE / FILE SELECTED ===== */}
                {(stage === 'idle' || stage === 'error') && (
                    <div className="glass-card p-8">
                        {/* Drop Zone */}
                        <div
                            className={`drop-zone rounded-2xl p-12 text-center cursor-pointer transition-all ${dragActive ? 'drop-zone-active' : ''
                                }`}
                            onDragEnter={handleDrag}
                            onDragLeave={handleDrag}
                            onDragOver={handleDrag}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                onChange={handleFileChange}
                                id="file-input"
                            />
                            <div className="mb-4">
                                <svg className="mx-auto w-16 h-16 text-[#EFD2B0] animate-float opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                            </div>
                            <p className="text-lg font-medium text-slate-200">
                                {file ? file.name : 'drop a file here or browse.'}
                            </p>
                            {file && (
                                <p className="text-dark-400 mt-2 text-sm">
                                    {formatBytes(file.size)} • {file.type || 'Unknown type'}
                                </p>
                            )}
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                                {error}
                            </div>
                        )}

                        {/* Settings Panel */}
                        {file && (
                            <>
                                <button
                                    onClick={() => setShowSettings(!showSettings)}
                                    className="mt-6 text-sm text-primary-400 hover:text-primary-300 flex items-center gap-2 transition-colors"
                                >
                                    <svg className={`w-4 h-4 transition-transform ${showSettings ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                    {showSettings ? 'Hide' : 'Show'} Settings
                                </button>

                                {showSettings && (
                                    <div className="mt-4 space-y-4 p-4 bg-dark-900/30 rounded-xl border border-primary-500/10">
                                        <div>
                                            <label className="block text-sm text-dark-300 mb-1.5">Link Expiry</label>
                                            <select
                                                value={expiresIn}
                                                onChange={(e) => setExpiresIn(e.target.value)}
                                                id="expiry-select"
                                            >
                                                <option value="1h">1 hour</option>
                                                <option value="24h">24 hours</option>
                                                <option value="3d">3 days</option>
                                                <option value="7d">7 days</option>
                                                <option value="30d">30 days</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm text-dark-300 mb-1.5">Max Downloads (optional)</label>
                                            <input
                                                type="number"
                                                placeholder="Unlimited"
                                                value={maxDownloads}
                                                onChange={(e) => setMaxDownloads(e.target.value)}
                                                min="1"
                                                id="max-downloads-input"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm text-dark-300 mb-1.5">Password (optional)</label>
                                            <input
                                                type="password"
                                                placeholder="Set a download password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                id="password-input"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Send Button */}
                                <button
                                    onClick={startUpload}
                                    className="mt-6 w-full btn-genz py-4 text-lg tracking-wide"
                                    id="send-button"
                                >
                                    send it.
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* ===== UPLOADING ===== */}
                {(stage === 'uploading' || stage === 'completing') && (
                    <div className="glass-card p-8">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-white title-genz tracking-tight pb-1">
                                    {stage === 'completing' ? 'wrapping up...' : 'sending...'}
                                </h2>
                                <p className="text-slate-400/80 text-sm mt-1 truncate max-w-xs">{file?.name}</p>
                            </div>
                            <button
                                onClick={handleAbort}
                                className="px-4 py-2 text-sm text-slate-300 border border-slate-500/30 rounded-lg hover:bg-slate-500/20 transition-colors"
                                id="abort-button"
                            >
                                cancel
                            </button>
                        </div>

                        {/* Progress Bar */}
                        <div className="progress-bar-bg h-3 mb-4">
                            <div
                                className="progress-bar-fill h-full"
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>

                        {/* Stats */}
                        <div className="flex justify-between text-sm text-dark-400 mb-6">
                            <span>{progress.toFixed(1)}%</span>
                            <span>{formatSpeed(speed)}</span>
                            <span>ETA: {formatDuration(eta)}</span>
                        </div>

                        {/* Chunk Indicators */}
                        {chunks.length <= 100 && (
                            <div className="flex flex-wrap gap-1.5">
                                {chunks.map((chunk, i) => (
                                    <div
                                        key={i}
                                        className={`w-3 h-3 rounded-sm transition-colors ${chunk.status === 'done'
                                            ? 'bg-green-500'
                                            : chunk.status === 'uploading'
                                                ? 'bg-primary-500 animate-pulse'
                                                : chunk.status === 'error'
                                                    ? 'bg-red-500'
                                                    : 'bg-dark-700'
                                            }`}
                                        title={`Chunk ${i + 1}: ${chunk.status}`}
                                    />
                                ))}
                            </div>
                        )}
                        {chunks.length > 100 && (
                            <p className="text-dark-500 text-xs">
                                {chunks.filter(c => c.status === 'done').length} / {chunks.length} chunks uploaded
                            </p>
                        )}
                    </div>
                )}

                {/* ===== SUCCESS ===== */}
                {stage === 'success' && result && (
                    <div className="glass-card p-8 text-center">
                        <div className="mb-6">
                            <div className="w-20 h-20 mx-auto bg-[#408A71]/20 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h2 className="text-3xl font-bold text-white title-genz tracking-tight">sent.</h2>
                            <p className="text-slate-300/80 mt-2">
                                {result.fileName} • {formatBytes(result.fileSizeBytes)}
                            </p>
                        </div>

                        {/* Shareable Link */}
                        <div className="bg-dark-900/50 rounded-xl p-4 mb-6">
                            <p className="text-xs text-dark-500 mb-2 uppercase tracking-wider">Shareable Link</p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    readOnly
                                    value={shareUrl}
                                    className="flex-1 text-sm !bg-transparent !border-0 !p-0 text-primary-300"
                                    id="share-link-input"
                                />
                                <button
                                    onClick={handleCopyLink}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${copied
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-primary-500/20 text-primary-300 hover:bg-primary-500/30'
                                        }`}
                                    id="copy-link-button"
                                >
                                    {copied ? '✓ Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>

                        {/* QR Code */}
                        <div className="inline-block p-4 bg-white rounded-2xl mb-6">
                            <QRCodeSVG
                                value={shareUrl}
                                size={160}
                                bgColor="#ffffff"
                                fgColor="#1e1b4b"
                                level="M"
                            />
                        </div>

                        {/* Owner Token  */}
                        <div className="bg-dark-900/30 rounded-xl p-4 mb-6 text-left">
                            <p className="text-xs text-dark-500 mb-1 uppercase tracking-wider">Management Token</p>
                            <p className="text-xs text-dark-400 font-mono break-all">{ownerToken}</p>
                            <p className="text-xs text-dark-600 mt-1">Keep this token to revoke your link later.</p>
                        </div>

                        {/* Actions */}
                        <button
                            onClick={handleReset}
                            className="btn-genz py-3 px-8 text-lg w-full md:w-auto"
                            id="upload-another-button"
                        >
                            send another.
                        </button>
                    </div>
                )}
            </div>

            {/* P2P CTA Link */}
            {stage === 'idle' && (
                <div className="mt-10 text-center text-slate-400 text-sm tracking-wide bg-dark-900/40 px-6 py-3 rounded-full border border-slate-700/50 backdrop-blur-sm">
                    sending 1TB+? <a href="/p2p" className="text-[#EFD2B0] hover:text-white font-semibold transition-colors">try p2p infinite mode.</a>
                </div>
            )}

            {/* Footer */}
            <p className="mt-12 text-slate-500 text-sm">
                End-to-end encrypted • Files auto-delete after expiry
            </p>
        </div>
    );
}
