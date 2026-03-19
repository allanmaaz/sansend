import { Routes, Route } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import DownloadPage from './pages/DownloadPage';

function App() {
    return (
        <div className="relative min-h-screen overflow-hidden">
            {/* Background orbs */}
            <div className="bg-orb" style={{ width: 600, height: 600, top: '-10%', left: '-10%', background: '#6366f1' }} />
            <div className="bg-orb" style={{ width: 400, height: 400, bottom: '-5%', right: '-5%', background: '#8b5cf6' }} />
            <div className="bg-orb" style={{ width: 300, height: 300, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#4f46e5' }} />

            {/* Content */}
            <div className="relative z-10">
                <Routes>
                    <Route path="/" element={<UploadPage />} />
                    <Route path="/dl/:linkId" element={<DownloadPage />} />
                </Routes>
            </div>
        </div>
    );
}

export default App;
