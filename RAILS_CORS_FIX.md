# Fixing CORS for Rails Backend

Your web app is being blocked by CORS because your Rails API doesn't allow requests from your Vercel domain.

## Step 1: Install the rack-cors gem

In your Rails backend project, add this to your `Gemfile`:

```ruby
gem 'rack-cors'
```

Then run:
```bash
bundle install
```

## Step 2: Configure CORS

Open `config/initializers/cors.rb` (create it if it doesn't exist) and add:

```ruby
# config/initializers/cors.rb

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    # Allow your Vercel domain and localhost for development
    origins 'https://qiraat-react-native.vercel.app', 'http://localhost:19006', 'http://localhost:3000'

    # Or allow all origins (less secure, but simpler for testing):
    # origins '*'

    resource '*',
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head],
      credentials: false
  end
end
```

## Step 3: Restart Your Rails Server

If running locally:
```bash
rails server
```

If deployed on Railway:
- Commit and push the changes
- Railway will automatically redeploy

## Step 4: Verify CORS is Working

After deploying, check the response headers. You should see:
```
Access-Control-Allow-Origin: https://qiraat-react-native.vercel.app
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD
Access-Control-Allow-Headers: *
```

You can test this with:
```bash
curl -I https://qiraat-api-v2-production.up.railway.app/api/narrators
```

Look for the `Access-Control-Allow-Origin` header.

## Alternative: Allow All Origins (For Testing)

If you want to quickly test, you can allow all origins:

```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins '*'  # Allow all origins (use only for testing!)

    resource '*',
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end
```

**Note:** Allowing all origins (`*`) is less secure and should only be used for testing. In production, specify exact domains.

## Step 5: Deploy to Railway

1. Commit the changes:
   ```bash
   git add Gemfile Gemfile.lock config/initializers/cors.rb
   git commit -m "Add CORS support for web app"
   git push
   ```

2. Railway will automatically detect the changes and redeploy

3. Wait for deployment to complete (check Railway dashboard)

4. Test your Vercel app again - CORS errors should be gone!

## Troubleshooting

### Still getting CORS errors?

1. **Check if rack-cors is installed:**
   ```bash
   bundle list | grep rack-cors
   ```

2. **Verify cors.rb exists and is correct:**
   ```bash
   cat config/initializers/cors.rb
   ```

3. **Check Railway logs:**
   - Go to Railway dashboard
   - Check deployment logs for any errors

4. **Clear browser cache:**
   - Hard refresh your Vercel app (Ctrl+Shift+R or Cmd+Shift+R)
   - Or open in incognito mode

### CORS works but credentials don't?

If you need to send cookies/credentials, set:
```ruby
credentials: true
```

And in your frontend fetch calls, add:
```javascript
fetch(url, {
  credentials: 'include'
})
```

## Security Best Practices

For production:
1. Only allow specific origins (not `*`)
2. Only allow methods you actually use
3. Be specific about allowed headers
4. Set appropriate credentials policy

Example production config:
```ruby
Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins 'https://qiraat-react-native.vercel.app'

    resource '/api/*',
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options],
      credentials: false,
      max_age: 86400  # Cache preflight requests for 24 hours
  end
end
```
