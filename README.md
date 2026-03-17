# ChatGPT Audio Downloader 🎵

A lightweight and elegant Chrome/Edge/Brave extension that allows you to easily download the original audio file when using the "Read Aloud" feature on ChatGPT.

![Extension Icon](icon.png)

## 🌟 Key Features
- **Instant Audio Download:** Automatically captures the direct audio stream from OpenAI's server the moment you click the "Read Aloud" button.
- **In-session History Management:** Provides a sleek popup UI to view and download all generated audio files within your current tab session.
- **100% Secure & Privacy-focused:** This extension runs entirely offline on the client side (in your browser). It makes ZERO calls to any third-party servers, collects absolutely no user data, and does not interfere with your cookies or account sessions.

## 🛠 Installation

As this extension is currently an open-source project and not yet available on the Chrome Web Store, you can install it via Developer Mode:

1. Download this entire repository as a `.zip` file and extract it to a folder on your computer.
2. Open your browser and navigate to the Extensions management page: `chrome://extensions/` 
   *(For Edge, use `edge://extensions/`)*
3. Enable **"Developer mode"** using the toggle switch located in the top-right corner.
4. Click the **"Load unpacked"** button in the top-left corner.
5. Select the extracted `chatgpt_audio_downloader` folder. You're all set! 🎉

## 💡 How to Use
1. Visit [chatgpt.com](https://chatgpt.com) and prompt the AI to generate a text response.
2. Click the 🔊 (Read Aloud) icon located below ChatGPT's response.
3. Wait 1-2 seconds for the audio stream to be prepared. A green ⬇️ download button will automatically appear in the bottom-right corner of your screen.
4. Alternatively, you can click the **Extension icon** in your browser's toolbar at any time to view and download the history of requested audio files for that session!

## 🔐 Open Source Transparency (How it works)
The underlying code is straightforward and transparent. It utilizes an interception technique (overriding the `window.fetch` function) locally within `inject.js` to detect any network streams containing the keyword `synthesize`. Once detected, it simply `.clone()` the Blob stream and serves it as a downloadable file. There is no minified code, backdoors, or telemetry—feel free to inspect the source code!

---
*Created with ❤️ by CuongND & Antigravity AI*
