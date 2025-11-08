# Deploying to Vercel

This guide explains how to deploy your Expo React Native app to Vercel as a web application.

## Prerequisites

1. Install Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. Make sure you have a Vercel account at [vercel.com](https://vercel.com)

## Deployment Steps

### Option 1: Deploy via Vercel CLI (Recommended)

1. **Build the web version locally** (optional - Vercel will do this automatically):
   ```bash
   npm run build:web
   ```

2. **Login to Vercel** (first time only):
   ```bash
   vercel login
   ```

3. **Deploy to Vercel**:

   For preview deployment:
   ```bash
   vercel
   ```

   For production deployment:
   ```bash
   vercel --prod
   ```
   or
   ```bash
   npm run deploy
   ```

4. Follow the prompts:
   - Set up and deploy? **Y**
   - Which scope? Select your account
   - Link to existing project? **N** (first time) or **Y** (subsequent deployments)
   - What's your project's name? `aswaat-app` (or your preferred name)
   - In which directory is your code located? `./` (press Enter)

5. Vercel will build and deploy your app. You'll get a URL like:
   - Preview: `https://aswaat-app-xxx.vercel.app`
   - Production: `https://aswaat-app.vercel.app`

### Option 2: Deploy via GitHub (Automatic)

1. **Push your code to GitHub** (already done)

2. **Import project in Vercel**:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Vercel will auto-detect the Expo configuration
   - Click "Deploy"

3. **Automatic deployments**:
   - Every push to `main` branch will automatically deploy to production
   - Pull requests will create preview deployments

## Configuration

The app is configured with:
- **Build Command**: `npm run build:web`
- **Output Directory**: `dist`
- **Dev Command**: `npm run web`

These are set in `vercel.json` and `package.json`.

## Environment Variables

If your app needs environment variables:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add any required variables (API keys, URLs, etc.)

## Custom Domain

To use a custom domain:

1. Go to your Vercel project dashboard
2. Navigate to Settings → Domains
3. Add your custom domain
4. Follow DNS configuration instructions

## Important Notes

### React Native Gesture Handler
The app uses `react-native-gesture-handler` which works on web with some limitations:
- Swipe gestures work on web
- Some native-specific features may behave differently
- Test thoroughly on web to ensure all features work

### AsyncStorage
The app uses `@react-native-async-storage/async-storage` which automatically falls back to `localStorage` on web.

### Fonts
Custom fonts (NaskhNastaleeqIndoPakQWBW) are loaded via Expo's font loading system, which works on web.

### Testing Locally

Before deploying, test the web build locally:

```bash
# Build for web
npm run build:web

# Serve the dist folder
npx serve dist
```

Then open http://localhost:3000 to test.

## Troubleshooting

### Build fails
- Check build logs in Vercel dashboard
- Ensure all dependencies are in `package.json`
- Try building locally first: `npm run build:web`

### Gestures don't work
- Make sure `react-native-gesture-handler` is properly installed
- On web, gestures work but may feel slightly different than native

### Fonts not loading
- Check that font files are in the `assets` folder
- Verify `expo-font` is installed
- Check browser console for font loading errors

### API calls failing
- Check CORS settings on your backend API
- Verify API URLs are correct
- Add environment variables in Vercel if needed

## Monitoring

- View deployment logs in Vercel dashboard
- Set up error tracking (Sentry, LogRocket, etc.)
- Monitor performance with Vercel Analytics

## Redeployment

To redeploy after making changes:

```bash
# Commit and push changes
git add .
git commit -m "Update app"
git push

# If using CLI, run:
vercel --prod
```

If using GitHub integration, deployment happens automatically on push.
