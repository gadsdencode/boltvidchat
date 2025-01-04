import React, { useEffect, useRef, useState } from 'react';
    import io from 'socket.io-client';
    import axios from 'axios';

    const socket = io('http://localhost:5000');

    const VideoChat: React.FC = () => {
      const [roomId, setRoomId] = useState('');
      const [username, setUsername] = useState('');
      const [token, setToken] = useState('');
      const [messages, setMessages] = useState<string[]>([]);
      const [message, setMessage] = useState('');
      const localVideoRef = useRef<HTMLVideoElement>(null);
      const remoteVideoRef = useRef<HTMLVideoElement>(null);
      const peerConnection = useRef<RTCPeerConnection | null>(null);
      const localStream = useRef<MediaStream | null>(null);

      useEffect(() => {
        const getUserMedia = async () => {
          localStream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream.current;
          }
        };

        getUserMedia();
      }, []);

      const handleLogin = async () => {
        const response = await axios.post('http://localhost:5000/login', { username });
        setToken(response.data.token);
      };

      const joinRoom = () => {
        if (!token) return;

        socket.auth = { token };
        socket.connect();

        socket.emit('join-room', roomId);

        peerConnection.current = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        peerConnection.current.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit('ice-candidates', roomId, event.candidate);
          }
        };

        peerConnection.current.ontrack = (event) => {
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        };

        localStream.current?.getTracks().forEach((track) => {
          peerConnection.current?.addTrack(track, localStream.current!);
        });
      };

      const handleIceCandidate = (candidate: RTCIceCandidate) => {
        peerConnection.current?.addIceCandidate(new RTCIceCandidate(candidate));
      };

      const handleOffer = async (offer: RTCSessionDescriptionInit) => {
        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peerConnection.current?.createAnswer();
        await peerConnection.current?.setLocalDescription(answer);

        socket.emit('answer', roomId, answer);
      };

      const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
        await peerConnection.current?.setRemoteDescription(new RTCSessionDescription(answer));
      };

      const handleChatMessage = (sender: string, msg: string) => {
        setMessages((prevMessages) => [...prevMessages, `${sender}: ${msg}`]);
      };

      const sendMessage = () => {
        socket.emit('chat-message', roomId, message);
        setMessage('');
      };

      socket.on('ice-candidates', handleIceCandidate);
      socket.on('offer', handleOffer);
      socket.on('answer', handleAnswer);
      socket.on('chat-message', handleChatMessage);

      return (
        <div>
          <h2>Video Chat</h2>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button onClick={handleLogin}>Login</button>
          <br />
          <input
            type="text"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button onClick={joinRoom}>Join Room</button>
          <br />
          <video ref={localVideoRef} autoPlay playsInline muted />
          <video ref={remoteVideoRef} autoPlay playsInline />
          <br />
          <div>
            <input
              type="text"
              placeholder="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button onClick={sendMessage}>Send</button>
          </div>
          <div>
            {messages.map((msg, index) => (
              <div key={index}>{msg}</div>
            ))}
          </div>
        </div>
      );
    };

    export default VideoChat;
