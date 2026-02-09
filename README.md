# NovelSeek Pro PC

[![Built with Pollinations](https://img.shields.io/badge/Built%20with-Pollinations-8a2be2?style=for-the-badge&logo=data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22%20viewBox%3D%220%200%20124%20124%22%3E%3Ccircle%20cx%3D%2262%22%20cy%3D%2262%22%20r%3D%2262%22%20fill%3D%22%23ffffff%22/%3E%3C/svg%3E&logoColor=white&labelColor=6a0dad)](https://pollinations.ai)

[中文文档（Chinese）](README.zh-CN.md)

NovelSeek Pro PC is a desktop tool for long-form novel creation, covering the full workflow from outline planning and chapter generation to illustration/cover generation and ebook export.  
It is built with `Tauri + React + TypeScript + Rust + SQLite`, supports local-first usage, and persists project data on-device.

## Pollinations Attribution

- Official website: <https://pollinations.ai>
- Official Logo (White): <https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo.svg>
- Official Logo Text (White): <https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo-text.svg>

> Note: official logos are white, so they are previewed on dark background blocks below.

<table>
  <tr>
    <td bgcolor="#0f172a" style="padding: 14px;">
      <a href="https://pollinations.ai">
        <img src="https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo.svg" alt="pollinations.ai Logo White" width="120" />
      </a>
    </td>
  </tr>
</table>

<table>
  <tr>
    <td bgcolor="#0f172a" style="padding: 14px;">
      <a href="https://pollinations.ai">
        <img src="https://raw.githubusercontent.com/pollinations/pollinations/main/assets/logo-text.svg" alt="pollinations.ai Logo Text White" width="280" />
      </a>
    </td>
  </tr>
</table>

## Version

- Current version: `v1.2.1`
- Primary platform: Windows

## Feature Overview

### 1. Writing Workflow
- Create, edit, and delete novel projects
- Chapter list and prologue management
- Streaming chapter generation, continuation, and polishing
- Quick chapter switching directly inside the chapter editor
- AI outline generation with structured outline editing

### 2. AI Capabilities
- Text model platforms: `DeepSeek / OpenAI / OpenRouter / Gemini (OpenAI-compatible) / Custom`
- Required text model config: `API Key / API URL / Model / Temperature`
- Per-platform independent config persistence with custom platform profiles
- Text generation for outlines, chapters, prologues, polishing, and image prompts
- Pollinations support for chapter cover/promotional images, paragraph illustrations, book covers, and character portraits
- Illustration anchors with preview, move, and delete operations
- Chapter cover generation supports preset/custom style input

### 3. Character Management
- Core fields: name, role, personality, background, motivation
- Generate appearance text from character data and sync it back into outline character sections
- Generate one-inch character portraits, including portrait-only regeneration

### 4. Ebook Export
- Export entry from the chapter list page
- Supported formats:
  - `PDF` (A4, supports novel cover / chapter cover / paragraph illustrations)
  - `TXT` (plain text)
  - `EPUB` (plain text)
  - `MOBI` (plain text)
- Export preview supports removing specific paragraph illustrations
- Export settings and edit progress are persisted

### 5. UI and Interaction
- Enhanced sidebar with navigation, project shortcuts, and theme switch
- One-click dark/light theme toggle
- API key show/hide support in settings
- Key-acquisition links for major text model platforms and Pollinations
- UI language switch support (Chinese/English)

## Quick Start

### Requirements

- Node.js `>=18`
- Rust `>=1.75`
- npm

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
npm run tauri:dev
```

### Production Build

```bash
npm run tauri:build
```

Default installer output directories:

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`

## API Configuration

Configure in the app `Settings` page:

- Text model platform profile (multiple profiles supported):
  - `API Key`
  - `API URL`
  - `Model`
  - `Temperature`
- `Pollinations API Key` (optional for image generation)

## Project Structure

```text
NovelSeek-Pro-PC/
├─ src/
│  ├─ components/      # Shared UI components
│  ├─ pages/           # Pages: home/project/outline/editor/export/settings
│  ├─ services/        # Frontend API wrappers
│  ├─ store/           # Zustand global state
│  ├─ types/           # TypeScript type definitions
│  └─ utils/           # Utility helpers
├─ src-tauri/
│  ├─ src/
│  │  ├─ api/          # DeepSeek / Pollinations integrations
│  │  ├─ commands/     # Tauri command handlers
│  │  ├─ db/           # SQLite init and migrations
│  │  ├─ services/     # Backend business services
│  │  └─ models.rs     # Rust models
│  └─ tauri.conf.json
├─ package.json
└─ README.md
```

## Notes

- Non-PDF formats are currently text-only exports without image assets.
- PDF CJK rendering depends on selected system fonts; if rendering fails, switch fonts and export again.

## License

MIT
