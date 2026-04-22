import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, Button } from './ui';
import { motion } from 'motion/react';

function jwtPayloadUserId(jwtToken: string): string {
  try {
    const p = jwtToken.split('.')[1];
    if (!p) return 'viewer';
    const b64 = p.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const json = JSON.parse(atob(b64 + pad)) as { id?: string };
    return json?.id != null ? String(json.id) : 'viewer';
  } catch {
    return 'viewer';
  }
}

interface LiveMonitorProps {
  examId: number;
  token: string;
  onClose: () => void;
}

export function LiveMonitor({ examId, token, onClose }: LiveMonitorProps) {
  const [students, setStudents] = useState<{ id: string, socketId: string }[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const peerConnectionsRef = useRef<{ [id: string]: RTCPeerConnection }>({});
  const videoRefs = useRef<{ [id: string]: HTMLVideoElement | null }>({});

  useEffect(() => {
    const viewerId = jwtPayloadUserId(token);
    const socketUrl =
      (import.meta.env.VITE_SOCKET_URL as string | undefined)?.trim() ||
      (import.meta.env.DEV ? 'http://127.0.0.1:3001' : undefined);
    const socketOpts = {
      path: '/socket.io',
      auth: { token },
      reconnectionDelay: 2500,
      reconnectionDelayMax: 15000,
    };
    const socket = socketUrl ? io(socketUrl, socketOpts) : io(socketOpts);
    socketRef.current = socket;

    let socketExplainLogged = false;
    socket.on('connect_error', () => {
      if (socketExplainLogged) return;
      socketExplainLogged = true;
      console.warn(
        '[LiveMonitor] Socket.io ulanmadi (502: realtime xizmati serverda ishlamayapti). Tekshirish: sudo systemctl status onlinetest-realtime'
      );
    });

    socket.emit('join-exam', examId, 'proctor', viewerId);

    socket.on('student-joined', async (userId: string, socketId: string) => {
      setStudents(prev => {
        if (!prev.find(s => s.socketId === socketId)) {
          return [...prev, { id: userId, socketId }];
        }
        return prev;
      });

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnectionsRef.current[socketId] = pc;

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('ice-candidate', socketId, event.candidate);
        }
      };

      pc.ontrack = (event) => {
        const video = videoRefs.current[socketId];
        if (video) {
          video.srcObject = event.streams[0];
        }
      };

      const offer = await pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      socket.emit('offer', socketId, offer, socket.id, viewerId);
    });

    socket.on('answer', async (fromId: string, answer: RTCSessionDescriptionInit) => {
      const pc = peerConnectionsRef.current[fromId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('ice-candidate', async (fromId: string, candidate: RTCIceCandidateInit) => {
      const pc = peerConnectionsRef.current[fromId];
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.disconnect();
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    };
  }, [examId, token]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-6"
    >
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Live Monitoring (Exam {examId})</h2>
        <Button variant="destructive" onClick={onClose}>Close Monitor</Button>
      </div>
      
      {students.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/50">
          No students currently connected to this exam.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto">
          {students.map(student => (
            <Card key={student.socketId} className="bg-gray-900 border-gray-800 overflow-hidden">
              <CardHeader className="p-3 bg-gray-800/50">
                <CardTitle className="text-sm text-gray-200">Student ID: {student.id}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 aspect-video bg-black relative">
                <video
                  ref={el => { videoRefs.current[student.socketId] = el; }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </motion.div>
  );
}
