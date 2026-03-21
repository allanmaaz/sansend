import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    getFileMetadata,
    authenticateFile,
    getDownloadUrl,
    FileMetadata,
} from '../api';
import { formatBytes, formatTimeRemaining } from '../utils';

export default function DownloadPage() {
    const { linkId } = useParams<{ linkId: string }>();
    const [password, setPassword] = useState('');
    const [authToken, setAuthToken] = useState('');
    const [authError, setAuthError] = useState('');
    const [downloading, setDownloading] = useState(false);

    const { data: meta, isLoading, error } = useQuery<FileMetadata>({
        queryKey: ['file-metadata', linkId],
        queryFn: () => getFileMetadata(linkId!),
        enabled: !!linkId,
        retry: false,
    });

    const handleAuth = async () => {
        if (!linkId) return;
        setAuthError('');
        try {
            const res = await authenticateFile(linkId, password);
            setAuthToken(res.token);
        } catch (err: any) {
            const msg = err.response?.data?.message || err.response?.data?.error || 'Wrong password';
            setAuthError(msg);
        }
    };

    const handleDownload = () => {
        if (!linkId) return;
        setDownloading(true);
        const url = getDownloadUrl(linkId, authToken || undefined);
        window.location.href = url;
        setTimeout(() => setDownloading(false), 3000);
    };

    // Error states
    const getErrorDisplay = () => {
        if (!error) return null;
        const status = (error as any)?.response?.status;
        const message = (error as any)?.response?.data?.message;

        if (status === 404) {
            return { icon: '🔍', title: 'File Not Found', desc: 'This link doesn\'t exist or has been removed.' };
        }
        if (status === 410) {
            return { icon: '⏰', title: 'Link Expired', desc: message || 'This download link has expired or been revoked.' };
        }
        if (status === 429) {
            return { icon: '📊', title: 'Download Limit Reached', desc: 'The maximum number of downloads has been reached.' };
        }
        return { icon: '❌', title: 'Error', desc: message || 'Something went wrong. Please try again.' };
    };

    const errorDisplay = getErrorDisplay();

    const isExpired = meta?.expiresAt && new Date(meta.expiresAt).getTime() < Date.now();
    const isLimitReached = meta?.maxDownloads && meta.downloadCount >= meta.maxDownloads;
    const needsPassword = meta?.passwordProtected && !authToken;

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
            {/* Header */}
            <div className="text-center mb-8">
                <div className="text-center mb-10 relative z-10">
                    <h1 className="text-6xl md:text-7xl font-sans tracking-tighter title-genz mb-4 drop-shadow-xl">
                        sansend.
                    </h1>
                    <p className="text-slate-300/80 text-lg md:text-xl font-medium tracking-wide">
                        {meta?.fileName ? 'your transfer is ready.' : 'loading...'}
                    </p>
                </div>
            </div>

            <div className="w-full max-w-lg">
                {/* Loading */}
                {isLoading && (
                    <div className="glass-card p-12 text-center">
                        <div className="w-12 h-12 mx-auto border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                        <p className="mt-4 text-dark-400">Loading file information...</p>
                    </div>
                )}

                {/* Error */}
                {errorDisplay && (
                    <div className="glass-card p-12 text-center">
                        <div className="text-5xl mb-4">{errorDisplay.icon}</div>
                        <h2 className="text-2xl font-bold text-dark-100 mb-2">{errorDisplay.title}</h2>
                        <p className="text-dark-400">{errorDisplay.desc}</p>
                        <a
                            href="/"
                            className="inline-block mt-6 px-6 py-3 btn-glow text-white font-semibold rounded-xl"
                        >
                            Send Your Own File
                        </a>
                    </div>
                )}

                {/* File Card */}
                {meta && !errorDisplay && (
                    <div className="glass-card p-8">
                        {/* File Info */}
                        <div className="flex flex-col items-center justify-center mb-6">
                            <div className="w-20 h-20 mx-auto bg-[#547792]/20 rounded-full flex items-center justify-center mb-4">
                                <svg className="w-10 h-10 text-[#547792] animate-float" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                            </div>
                            <h2 className="text-2xl font-bold text-white title-genz tracking-tight truncate px-4">
                                {meta.fileName}
                            </h2>
                            <p className="text-slate-300/80 mt-2 text-sm">
                                {formatBytes(meta.fileSizeBytes)}
                                {meta.maxDownloads && ` • ${meta.maxDownloads - meta.downloadCount} downloads left`}
                            </p>
                        </div>

                        {/* Expired / Limit */}
                        {isExpired && (
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm mb-6">
                                ⏰ This link has expired.
                            </div>
                        )}
                        {isLimitReached && (
                            <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl text-orange-400 text-sm mb-6">
                                📊 The download limit has been reached.
                            </div>
                        )}

                        {/* Password Gate */}
                        {needsPassword && !isExpired && !isLimitReached && (
                            <div className="glass-card p-8 text-center max-w-sm mx-auto">
                                <div className="mb-6">
                                    <div className="w-20 h-20 mx-auto bg-[#408A71]/20 rounded-full flex items-center justify-center mb-4">
                                        <svg className="w-10 h-10 text-[#EFD2B0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                    </div>
                                    <h2 className="text-2xl font-bold text-white title-genz tracking-tight mb-2">password protected</h2>
                                    <p className="text-slate-300/80 text-sm">enter the password to unlock this transfer.</p>
                                </div>
                                <input
                                    type="password"
                                    placeholder="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                                    className="mb-4 text-center"
                                />
                                <button
                                    onClick={handleAuth}
                                    className="w-full btn-genz py-3 font-semibold"
                                >
                                    unlock.
                                </button>
                                {authError && (
                                    <p className="text-red-400 text-sm mt-2">{authError}</p>
                                )}
                            </div>
                        )}

                        {/* Download Button */}
                        {!isExpired && !isLimitReached && (!meta.passwordProtected || authToken) && (
                            <button
                                onClick={handleDownload}
                                disabled={downloading}
                                className={`w-full btn-glow text-white font-semibold py-4 rounded-xl text-lg flex items-center justify-center gap-3 ${downloading ? 'opacity-70 cursor-not-allowed' : ''
                                    }`}
                                id="download-button"
                            >
                                {downloading ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Starting download...
                                    </>
                                ) : (
                                    <>
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        Download
                                    </>
                                )}
                            </button>
                        )}

                        {/* Upload date */}
                        <p className="text-center text-dark-600 text-xs mt-4">
                            Uploaded {new Date(meta.createdAt).toLocaleDateString('en-US', {
                                year: 'numeric', month: 'short', day: 'numeric',
                            })}
                        </p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <p className="mt-12 text-dark-600 text-sm">
                <a href="/" className="hover:text-primary-400 transition-colors">Send your own file →</a>
            </p>
        </div>
    );
}
