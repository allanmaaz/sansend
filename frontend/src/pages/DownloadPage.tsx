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
                <a href="/" className="inline-block">
                    <h1 className="text-4xl font-extrabold bg-gradient-to-r from-primary-400 via-primary-300 to-purple-400 bg-clip-text text-transparent mb-2">
                        Sansend
                    </h1>
                </a>
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
                        <div className="flex items-start gap-4 mb-6">
                            <div className="w-14 h-14 bg-primary-500/20 rounded-2xl flex items-center justify-center flex-shrink-0">
                                <svg className="w-7 h-7 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                                        d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                                <h2 className="text-xl font-bold text-dark-100 truncate">{meta.fileName}</h2>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-dark-400">
                                    <span>{formatBytes(meta.fileSizeBytes)}</span>
                                    <span>•</span>
                                    <span>{formatTimeRemaining(meta.expiresAt)}</span>
                                    {meta.maxDownloads && (
                                        <>
                                            <span>•</span>
                                            <span>{meta.downloadCount}/{meta.maxDownloads} downloads</span>
                                        </>
                                    )}
                                </div>
                            </div>
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
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-3 text-dark-300 text-sm">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                    This file is password-protected
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="password"
                                        placeholder="Enter password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                                        id="download-password-input"
                                    />
                                    <button
                                        onClick={handleAuth}
                                        className="px-6 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-xl font-medium transition-colors flex-shrink-0"
                                        id="unlock-button"
                                    >
                                        Unlock
                                    </button>
                                </div>
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
