import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    headers: {
        'Content-Type': 'application/json',
    },
});

// ---- Types ----
export interface UploadInitRequest {
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
    expiresIn?: string;
    maxDownloads?: number;
    password?: string;
}

export interface UploadInitResponse {
    uploadId: string;
    totalChunks: number;
    chunkSizeBytes: number;
    ownerToken: string;
}

export interface PresignResponse {
    presignedUrl: string;
    chunkNumber: number;
}

export interface UploadStatusResponse {
    uploadId: string;
    status: string;
    totalChunks: number;
    uploadedChunks: number[];
}

export interface UploadCompleteResponse {
    linkToken: string;
    downloadUrl: string;
    fileName: string;
    fileSizeBytes: number;
}

export interface FileMetadata {
    fileName: string;
    fileSizeBytes: number;
    mimeType: string;
    expiresAt: string;
    downloadCount: number;
    maxDownloads: number | null;
    passwordProtected: boolean;
    createdAt: string;
}

export interface FileAuthResponse {
    token: string;
}

// ---- API Functions ----
export const initUpload = async (data: UploadInitRequest): Promise<UploadInitResponse> => {
    const res = await api.post('/upload/init', data);
    return res.data;
};

export const getPresignedUrl = async (uploadId: string, chunkNum: number): Promise<PresignResponse> => {
    const res = await api.get(`/upload/${uploadId}/presign/${chunkNum}`);
    return res.data;
};

export const confirmChunk = async (uploadId: string, chunkNum: number, etag: string): Promise<void> => {
    await api.post(`/upload/${uploadId}/chunk/${chunkNum}/confirm`, { etag });
};

export const getUploadStatus = async (uploadId: string): Promise<UploadStatusResponse> => {
    const res = await api.get(`/upload/${uploadId}/status`);
    return res.data;
};

export const completeUpload = async (uploadId: string, request?: UploadInitRequest): Promise<UploadCompleteResponse> => {
    const res = await api.post(`/upload/${uploadId}/complete`, request || {});
    return res.data;
};

export const abortUpload = async (uploadId: string): Promise<void> => {
    await api.delete(`/upload/${uploadId}/abort`);
};

export const getFileMetadata = async (linkId: string): Promise<FileMetadata> => {
    const res = await api.get(`/file/${linkId}`);
    return res.data;
};

export const authenticateFile = async (linkId: string, password: string): Promise<FileAuthResponse> => {
    const res = await api.post(`/file/${linkId}/auth`, { password });
    return res.data;
};

export const getDownloadUrl = (linkId: string, token?: string): string => {
    const base = `/api/file/${linkId}/download`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
};

export const revokeFile = async (linkId: string, ownerToken: string): Promise<void> => {
    await api.delete(`/file/${linkId}`, {
        headers: { 'X-Owner-Token': ownerToken },
    });
};

export default api;
