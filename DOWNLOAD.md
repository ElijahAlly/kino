# Downloading a video to your phone

Downloads are remuxed to MP4 on your MacBook (so they play on iPhone / Android), then streamed straight to your phone — no temp files, no cloud.

## Requirements

1. **MacBook**
   - `ffmpeg` installed: `brew install ffmpeg`
   - Kino dev server running: `npm run dev` from the `kino` directory
   - Awake (no lid-close-to-sleep) for the entire duration of the download
2. **Tailscale**
   - Installed and signed in on **both** your MacBook and your phone
3. **Browse kino through your MacBook's Tailscale URL** — not the Vercel URL.
   The Vercel deployment can't run ffmpeg, so downloads are blocked there.

## How to download

1. Open a video in the player on your phone.
2. Tap the download icon in the top-right.
3. Confirm the checklist, then tap **Continue download**.
4. The browser will save the file to your phone (Files app on iOS, Downloads on Android).

The output is an `.mp4` with stereo AAC audio. Subtitles are dropped.
