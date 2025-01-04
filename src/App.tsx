import React from 'react';
import './index.css';
import VideoChat from './components/VideoChat';
import { AuthProvider } from './contexts/AuthContext';
import AnimatedBackground from './components/AnimatedBackground';

function App() {
  return (
    <AuthProvider>
      <div className="App">
        <AnimatedBackground />
        <VideoChat />
      </div>
    </AuthProvider>
  );
}

export default App;
