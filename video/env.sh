# Source from the repo root:  . video/env.sh
# Puts the pinned ffmpeg (ffmpeg-static) and ffprobe (@ffprobe-installer) from video/node_modules
# first on PATH, so Product Demo Director, the camera and the checks all use the same binaries.
# Needs `npm ci` in video/ first. Nothing is installed system-wide.
_tv_video="$(git rev-parse --show-toplevel)/video/node_modules"
export PATH="$_tv_video/ffmpeg-static:$_tv_video/@ffprobe-installer/darwin-arm64:$PATH"
unset _tv_video
