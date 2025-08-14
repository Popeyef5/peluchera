'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flex, IconButton, Box } from "@chakra-ui/react"
import { BsFullscreen, BsFullscreenExit } from "react-icons/bs";
import { useColorMode } from './ui/color-mode';
import { useIsMobile } from './hooks/useIsMobile';
import { useClaw } from './providers';

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
  const isMobile = useIsMobile();
  const { colorMode } = useColorMode();
  const { clawSocketOn } = useClaw();
  const [videoMsg, setVideoMsg] = useState("");

  /* we keep the reader so we can clean it up later -- avoids “unused” warning */
  const readerRef = useRef<{ close?: () => void } | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = '/reader.js';
    script.defer = true;
    script.onload = () => {
      // /* eslint-disable-next-line @typescript-eslint/consistent-type-assertions */
      const ReaderCtor = (window as unknown as { MediaMTXWebRTCReader: typeof window.MediaMTXWebRTCReader }).MediaMTXWebRTCReader;

      readerRef.current = new ReaderCtor({
        url: 'https://cl4ws.com/video_feed/whep',
        onError: (err: string) => {
          setVideoMsg(err);
        },
        onTrack: (evt: RTCTrackEvent) => {
          setVideoMsg("");
          const video = document.getElementById('video') as HTMLVideoElement;
          video.srcObject = evt.streams[0];
        },
      });
    };
    document.body.appendChild(script);
  }, [setVideoMsg]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFS, setIsFS] = useState(false);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const h = () => setIsFS(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  // return null;

  return (
    <Flex
      style={{
        width: '100%', position: 'relative', aspectRatio: 4 / 3, height: "fit-content", maxHeight: "100%"
      }}
      onDoubleClick={toggleFullscreen}
      ref={wrapRef}
      p={isFS ? "24px" : 0}
      justify={"center"}
      background={colorMode === "dark" ? "black" : "white"}
      borderRadius={"2rem"}
    >
      <video
        id="video"
        style={{
          // width: '100%',
          aspectRatio: 4 / 3,
          background: '#1e1e1e',
          borderRadius: "1.5rem"
        }}
        autoPlay
        muted
        playsInline
        ref={videoRef}
      />
      <Box
        position="absolute"
        maxHeight="100%"
        width='100%'
        aspectRatio={4 / 3}
        display='flex'
        alignItems='center'
        justifyContent='center'
        fontWeight='bold'
        fontSize='16px'
        color='white'
        padding='20px'
        pointerEvents='none'
        textAlign='center'
        boxSizing='border-box'
        textShadow='0 0 5px black'
        borderRadius='1.5rem'
      >
        {videoMsg}
      </Box>
      {
        clawSocketOn && !isMobile && <IconButton
          position={"absolute"}
          bottom={"2.5vh"}
          right={"3.33vh"}
          size={"2xl"}
          variant={"ghost"}
          rounded={"full"}
          color={isFS ? colorMode === "dark" ? "white" : "black" : "white"}
          onClick={toggleFullscreen}
          _hover={{ color: colorMode === "light" ? "black" : "white" }}
        >
          {isFS ? <BsFullscreenExit /> : <BsFullscreen />}
        </IconButton>
      }
    </Flex >
  );
}
