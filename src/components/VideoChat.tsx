import React, { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { gsap } from 'gsap';
import { FaVideo, FaMicrophone, FaPaperPlane, FaDoorOpen, FaVideoSlash, FaMicrophoneSlash, FaSignOutAlt } from 'react-icons/fa';
import { useAuth } from '../contexts/AuthContext';
import Auth from './Auth';

interface Message {
  sender: string;
  content: string;
  timestamp: number;
}

interface Participant {
  username: string;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
}

const VideoChat: React.FC = () => {
  const { user, token, logout } = useAuth();
  const [roomId, setRoomId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [message, setMessage] = useState('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInRoom, setIsInRoom] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const createPeerConnection = useCallback(() => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    };

    const pc = new RTCPeerConnection(configuration);

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', roomId, event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE Connection State:', pc.iceConnectionState);
    };

    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        if (localStream.current) {
          pc.addTrack(track, localStream.current);
        }
      });
    }

    peerConnection.current = pc;
    return pc;
  }, [roomId]);

  const initializeSocket = useCallback(() => {
    if (!token) return;

    const socket = io('http://localhost:5000', {
      auth: { token }
    });

    socket.on('user-connected', ({ username, participants: roomParticipants }: { username: string, participants: string[] }) => {
      setParticipants(roomParticipants.map((name: string) => ({
        username: name,
        isVideoEnabled: true,
        isAudioEnabled: true
      })));
    });

    socket.on('initiate-call', async () => {
      const pc = createPeerConnection();
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', roomId, offer);
      } catch (err) {
        console.error('Error creating offer:', err);
      }
    });

    socket.on('offer', async ({ offer, from }) => {
      const pc = createPeerConnection();
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', roomId, answer);
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    });

    socket.on('answer', async ({ answer }) => {
      try {
        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      try {
        await peerConnection.current?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    });

    socket.on('chat-message', (sender: string, content: string) => {
      setMessages(prev => [...prev, {
        sender,
        content,
        timestamp: Date.now()
      }]);
    });

    socket.on('user-disconnected', ({ username, participants: roomParticipants }: { username: string, participants: string[] }) => {
      setParticipants(roomParticipants.map((name: string) => ({
        username: name,
        isVideoEnabled: true,
        isAudioEnabled: true
      })));
    });

    socketRef.current = socket;
    return socket;
  }, [token, roomId, createPeerConnection]);

  const joinRoom = useCallback(async () => {
    if (!token || !roomId) return;

    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream.current;
      }

      const socket = initializeSocket();
      socket?.emit('join-room', roomId);

      setIsInRoom(true);
      gsap.to('.room-container', { duration: 0.5, opacity: 0, y: -50, ease: 'power2.out' });
      gsap.to('.video-chat-container', { duration: 0.5, opacity: 1, y: 0, delay: 0.5, ease: 'power2.out' });
    } catch (err) {
      setError('Failed to access camera/microphone. Please check permissions.');
    }
  }, [token, roomId, initializeSocket]);

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      videoTrack.enabled = !videoTrack.enabled;
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const toggleAudio = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  const sendMessage = () => {
    if (message.trim() && socketRef.current) {
      socketRef.current.emit('chat-message', roomId, message);
      setMessages(prev => [...prev, {
        sender: user?.username || '',
        content: message,
        timestamp: Date.now()
      }]);
      setMessage('');
    }
  };

  const handleLogout = () => {
    localStream.current?.getTracks().forEach(track => track.stop());
    peerConnection.current?.close();
    socketRef.current?.disconnect();
    logout();
  };

  useEffect(() => {
    return () => {
      localStream.current?.getTracks().forEach(track => track.stop());
      peerConnection.current?.close();
      socketRef.current?.disconnect();
    };
  }, []);

  if (!user || !token) {
    return <Auth onSuccess={() => {}} />;
  }

  return (
    <div className="futuristic-app">
      {error && (
        <div className="error-message">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}
      
      <div className="user-info">
        <span>Welcome, {user.username}</span>
        <button onClick={handleLogout} className="logout-button">
          <FaSignOutAlt /> Logout
        </button>
      </div>

      <div className="room-container" style={{ display: !isInRoom ? 'flex' : 'none' }}>
        <h2 className="neon-text">Join a Room</h2>
        <input
          type="text"
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="futuristic-input"
        />
        <button onClick={joinRoom} className="futuristic-button">
          <FaDoorOpen /> Join Room
        </button>
      </div>

      <div className="video-chat-container" style={{ display: isInRoom ? 'flex' : 'none' }}>
        <div className="video-container">
          <div className="video-wrapper">
            <video ref={localVideoRef} autoPlay playsInline muted className="local-video" />
            <div className="participant-name">You ({user.username})</div>
          </div>
          <div className="video-wrapper">
            <video ref={remoteVideoRef} autoPlay playsInline className="remote-video" />
            <div className="participant-name">
              {participants.length > 1 ? participants.find(p => p.username !== user.username)?.username : 'Waiting for peer...'}
            </div>
          </div>
          <div className="video-controls">
            <button onClick={toggleVideo} className={`control-button ${!isVideoEnabled ? 'disabled' : ''}`}>
              {isVideoEnabled ? <FaVideo /> : <FaVideoSlash />}
            </button>
            <button onClick={toggleAudio} className={`control-button ${!isAudioEnabled ? 'disabled' : ''}`}>
              {isAudioEnabled ? <FaMicrophone /> : <FaMicrophoneSlash />}
            </button>
          </div>
        </div>
        <div className="chat-container">
          <div className="messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.sender === user.username ? 'sent' : 'received'}`}>
                <div className="message-header">
                  <span className="sender">{msg.sender}</span>
                  <span className="timestamp">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="message-content">{msg.content}</div>
              </div>
            ))}
          </div>
          <div className="message-input">
            <input
              type="text"
              placeholder="Type your message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              className="futuristic-input"
            />
            <button onClick={sendMessage} className="futuristic-button">
              <FaPaperPlane />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoChat;
