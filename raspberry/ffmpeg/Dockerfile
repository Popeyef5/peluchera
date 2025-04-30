FROM jrottenberg/ffmpeg:4.4-alpine

ENV RTSP_URL=rtmp://192.168.0.237:8554/raspi
ENV VIDEO_DEVICE=/dev/video0

CMD ffmpeg -f v4l2 -i $VIDEO_DEVICE -vcodec libx264 -preset ultrafast -tune zerolatency -f rtsp $RTSP_URL
