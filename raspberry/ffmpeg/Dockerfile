FROM alpine:latest

ENV RTSP_URL=rtmp://192.168.0.237:8554/raspi
ENV VIDEO_DEVICE=/dev/video0

RUN apk add --no-cache ffmpeg

CMD ["ffmpeg", "-f", "v4l2", "-r", "30", "-i", "/dev/video0", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-f", "rtsp", "-rtsp_transport", "tcp", "-buffer_size", "30000", "rtsp://cryptoclaw.xyz:8554/video_feed"]
