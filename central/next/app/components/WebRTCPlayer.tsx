'use client';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    MediaMTXWebRTCReader: new (params: {
      url: string;
      onError?: (err: string) => void;
      onTrack?: (evt: RTCTrackEvent) => void;
    }) => { close?: () => void };
  }
}

export default function WebRTCPlayer() {
  /* we keep the reader so we can clean it up later -- avoids “unused” warning */
  const readerRef = useRef<{ close?: () => void } | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/reader.js';
    script.defer = true;
    script.onload = () => {
      /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
      const ReaderCtor = (window as unknown as { MediaMTXWebRTCReader: typeof window.MediaMTXWebRTCReader }).MediaMTXWebRTCReader;

      readerRef.current = new ReaderCtor({
        url: 'http://cryptoclaw.xyz/video_feed/whep',
        onError: (err: string) => {
          const msg = document.getElementById('message');
          if (msg) msg.innerText = err;
        },
        onTrack: (evt: RTCTrackEvent) => {
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
