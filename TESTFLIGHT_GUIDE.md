# TestFlight Upload Guide

This guide will walk you through uploading your React Native app to TestFlight for beta testing.

## Prerequisites

1. **Apple Developer Account** - You need an active Apple Developer Program membership ($99/year)
2. **Expo Account** - Sign up at https://expo.dev (free account works)
3. **EAS CLI** - We'll install this in the setup steps

## Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

## Step 2: Login to Expo

```bash
eas login
```

This will open a browser window where you can sign in with your Expo account (or create one if you don't have it).

## Step 3: Configure Your App

The app.json has been updated with:
- Bundle identifier: `com.aswaat.app`
- Build number: `1`

**Important**: Make sure the bundle identifier matches your Apple Developer account. If you need to change it, edit `app.json`:

```json
"ios": {
  "bundleIdentifier": "com.yourcompany.yourapp"
}
```

## Step 4: Link Your Apple Developer Account

```bash
eas build:configure
```

This will set up your project for EAS builds.

## Step 5: Create App Store Connect Record

Before building, you need to create your app in App Store Connect:

1. Go to https://appstoreconnect.apple.com
2. Sign in with your Apple Developer account
3. Click "My Apps" → "+" → "New App"
4. Fill in:
   - Platform: iOS
   - Name: Minrawi App (or your preferred name)
   - Primary Language: English (or your choice)
   - Bundle ID: Select or create `com.aswaat.app` (must match app.json)
   - SKU: A unique identifier (e.g., "minrawi-app-001")
5. Click "Create"

## Step 6: Build for iOS

Build your app for iOS production:

```bash
eas build --platform ios --profile production
```

This will:
- Ask you some questions about your Apple Developer account
- Upload your code to Expo's servers
- Build your iOS app in the cloud
- Generate an `.ipa` file

**Note**: The first build will take longer (15-30 minutes) as it sets up certificates and provisioning profiles.

## Step 7: Submit to TestFlight

Once the build completes, submit it to TestFlight:

```bash
eas submit --platform ios --profile production
```

This will:
- Upload your `.ipa` to App Store Connect
- Make it available in TestFlight

**Alternative**: You can also submit manually:
1. Go to App Store Connect → Your App → TestFlight
2. Wait for the build to process (can take 10-30 minutes)
3. Once processed, you can add internal/external testers

## Step 8: Add Testers

1. Go to App Store Connect → Your App → TestFlight
2. Click on "Internal Testing" or "External Testing"
3. Add testers by email or create a public link
4. Testers will receive an email invitation to install TestFlight and your app

## Important Notes

### Bundle Identifier
- Must be unique across all iOS apps
- Format: `com.company.appname`
- Cannot be changed after first submission to App Store Connect

### Build Number
- Increment this for each new build (`app.json` → `ios.buildNumber`)
- Version is separate from build number (`app.json` → `version`)

### Version Updates
When you want to release a new version:

1. Update version in `app.json`:
   ```json
   "version": "1.0.1"
   ```

2. Increment build number:
   ```json
   "ios": {
     "buildNumber": "2"
   }
   ```

3. Build and submit:
   ```bash
   eas build --platform ios --profile production
   eas submit --platform ios --profile production
   ```

## Troubleshooting

### "Bundle identifier not found"
- Make sure you've created the app in App Store Connect first
- Verify the bundle identifier in `app.json` matches App Store Connect

### Build fails
- Check the build logs in the Expo dashboard
- Ensure all dependencies are compatible
- Make sure your assets (icons, splash screens) are the correct format

### Certificate issues
- EAS will automatically manage certificates for you
- If you have existing certificates, you may need to revoke them or let EAS handle it

## Additional Resources

- [EAS Build Documentation](https://docs.expo.dev/build/introduction/)
- [EAS Submit Documentation](https://docs.expo.dev/submit/introduction/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)

## Quick Reference Commands

```bash
# Login
eas login

# Configure project
eas build:configure

# Build for iOS
eas build --platform ios --profile production

# Submit to TestFlight
eas submit --platform ios --profile production

# Check build status
eas build:list

# View build logs
eas build:view [BUILD_ID]
```

