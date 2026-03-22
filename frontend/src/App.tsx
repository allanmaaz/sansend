import { Routes, Route } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DownloadPage from './pages/DownloadPage';
import P2PPage from './pages/P2PPage';

function App() {
    return (
        <div className="relative min-h-screen overflow-hidden">
            {/* Background orbs */}
            <div className="bg-orb bg-orb-1"></div>
            <div className="bg-orb bg-orb-2"></div>
            <div className="bg-orb bg-orb-3"></div>

            {/* Content */}
            <div className="relative z-10">
                <Routes>
                    <Route path="/" element={<UploadPage />} />
                    <Route path="/dl/:linkId" element={<DownloadPage />} />
                    <Route path="/p2p/:roomId?" element={<P2PPage />} />
                </Routes>
            </div>
        </div>
    );
}

export default App;
