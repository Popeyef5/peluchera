'use client';
import { useEffect } from 'react';

export default function WebRTCPlayer() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/reader.js';
    script.defer = true;
    script.onload = () => {
      const reader = new (window as any).MediaMTXWebRTCReader({
        url: 'http://192.168.0.237/video_feed/whep',
        onError: (err: string) => {
          const msg = document.getElementById('message');
          if (msg) msg.innerText = err;
        },
        onTrack: (evt: any) => {
          const msg = document.getElementById('message');
          if (msg) msg.innerText = '';
          const video = document.getElementById('video') as HTMLVideoElement;
          video.srcObject = evt.streams[0];
        },
      });
    };
    document.body.appendChild(script);
  }, []);

  return (
    <div style={{ aspectRatio: '4/3', width: '50vw', position: 'relative'}}>
      <video
        id="video"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: '#1e1e1e', borderRadius: "1.5rem" }}
        autoPlay
        muted
        playsInline
      />
      <div
        id="message"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 'bold',
          fontSize: '16px',
          color: 'white',
          padding: '20px',
          pointerEvents: 'none',
          textAlign: 'center',
          boxSizing: 'border-box',
          textShadow: '0 0 5px black',
        }}
      ></div>
    </div>
  );
}
