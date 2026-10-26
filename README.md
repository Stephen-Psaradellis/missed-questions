# Missed Questions

Missed Questions is a lightweight static web app designed for Twitch streamers to surface viewer questions that get buried in fast chat. It anonymously reads public Twitch chat and highlights important questions that multiple viewers ask, helping streamers track and answer them effectively.

## Features

- Shows the top 5 open questions asked by distinct viewers.
- Displays question text, distinct user count, sample usernames, and the question's age.
- Click or press keys 1-5 to mark questions as answered and move them to an "Answered" list.
- Supports a compact overlay mode (`?overlay=1`) showing only the top question with a transparent background for on-stream display.
- Channel name can be set via URL param `?channel=<name>` or text box.
- Runs entirely client-side with no dependencies or build step.
- Connects anonymously to Twitch chat via WebSocket, requiring no login or user tokens.
- Saves question state in localStorage for session continuity.
- Simple, clean dark UI optimized for 400px width (ideal for OBS browser sources).

## Usage with OBS

1. **Dock UI:** Add a Browser Source in OBS with URL `file:///path/to/index.html?channel=<yourchannel>` or serve the folder over HTTP and use `http://localhost/.../index.html?channel=yourchannel`.
   - Shows the question list and answered questions.
   - Good for streamer companion window or multi-monitor setup.

2. **Overlay UI:** Use URL `file:///path/to/index.html?channel=<yourchannel>&overlay=1` in an OBS Browser Source.
   - Displays only the top question large and transparent.
   - Optimize size and position in OBS for your stream overlay.

## Privacy

- The app reads **public Twitch chat anonymously** using a guest connection with a random nickname.
- **No login or user authentication required.**
- No data is sent out from your browser; all processing happens locally.
- No personal data is collected or transmitted.

## How It Was Built

This project was written by OpenAI Codex in a read-only sandbox environment. The entire app is implemented as static HTML, JavaScript modules, and CSS, with no dependencies or build steps. It uses standard browser WebSocket APIs to connect anonymously to Twitch chat and pure JavaScript logic to detect, group, rank, and manage questions.

The app is designed with simplicity, privacy, and streamer usability in mind.

---

Feel free to customize or extend the app for your Twitch channel or share it with others!
