# Minrawi App - React Native Mushaf Viewer

A React Native app for displaying Quranic mushaf pages from the Minrawi Rails API.

## Features

- Displays mushaf pages with 13 lines of Arabic text
- Fetches data from Rails API
- Traditional mushaf layout
- Right-to-left (RTL) text rendering
- Proper Arabic font support

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Make sure the Rails API server is running:

   ```bash
   # In the minrawi directory
   rails server
   ```

3. Start the React Native app:
   ```bash
   npm start
   # or
   npm run ios    # for iOS
   npm run android # for Android
   npm run web    # for web
   ```

## Configuration

The app is configured to fetch page 3 from mushaf 1 by default:

```javascript
const API_URL = "http://localhost:3000/api/mushafs/1/pages/3";
```

To change the page or mushaf, modify the `API_URL` constant in `App.js`.

## For iOS Simulator

If running on iOS Simulator and connecting to localhost, you may need to update the API URL to:

```javascript
const API_URL = "http://127.0.0.1:3000/api/mushafs/1/pages/3";
// or for physical device on same network:
const API_URL = "http://YOUR_IP_ADDRESS:3000/api/mushafs/1/pages/3";
```

## Project Structure

- `App.js` - Main application component with API integration
- `Line` component - Renders a single line of Arabic text
- `PageView` component - Renders the entire page with 13 lines

## Technologies

- React Native 0.81.5 (via Expo)
- Expo SDK ~54.0.20
- React 19.1.0

## Arabic Text Rendering

The app joins all words in each line to create continuous Arabic text, which properly connects Arabic characters. The text is rendered with:

- RTL (Right-to-Left) direction
- Platform-specific Arabic fonts
- Proper font sizing (32px) and line height (56px)
- Traditional dark gray color (#1a1a1a)
# qiraat-react-native
