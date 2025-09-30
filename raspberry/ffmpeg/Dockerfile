FROM alpine:latest

ENV RTSP_URL=rtmp://192.168.0.237:8554/raspi
ENV VIDEO_DEVICE=/dev/video0

RUN apk add --no-cache ffmpeg curl

# CMD ["ffmpeg", "-f", "v4l2", "-r", "30", "-i", "/dev/video0", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-f", "rtsp", "-rtsp_transport", "tcp", "-buffer_size", "30000", "rtsp://cryptoclaw.xyz:8554/video_feed"]
CMD ["ffmpeg", "-f", "v4l2", "-thread_queue_size", "64", "-framerate", "30", "-video_size", "960x720", \
       "-i", "/dev/video0", "-vf", "format=yuv420p", \
       "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", \
       "-x264-params", "keyint=30:min-keyint=30:scenecut=0:nal-hrd=cbr", \
       "-g", "30", "-bf", "0", "-b:v", "3M", "-maxrate", "3M", "-bufsize", "600k", \
       "-fflags", "nobuffer", "-flags", "low_delay", "-analyzeduration", "0", "-probesize", "32", \
       "-f", "rtsp", "-rtsp_transport", "udp", "rtsp://cl4ws.com:8554/video_feed"]
