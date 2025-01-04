import React from 'react';
import './index.css';
import VideoChat from './components/VideoChat';
import { AuthProvider } from './contexts/AuthContext';

function App() {
  return (
    <AuthProvider>
      <div className="App">
        <VideoChat />
      </div>
    </AuthProvider>
  );
}

export default App;
