# Deploy SerwaaBroni to Vercel

## Step 1: Prepare Your Code

Your project is already in `/mnt/agents/output/app`. Copy it to your local machine or push to GitHub.

## Step 2: Set Environment Variables in Vercel

Go to your Vercel dashboard → Project → Settings → Environment Variables.

Add these (copy the exact values from your `.env` file):

| Variable | Value | Required? |
|----------|-------|-----------|
| `VITE_SUPABASE_URL` | `https://qumttowvyujqaubyshjq.supabase.co` | **Yes** |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` (your full anon key) | **Yes** |
| `VITE_ARKESEL_API_KEY` | Your Arkesel key (if you have one) | Optional |
| `VITE_BREVO_API_KEY` | Your Brevo key (if you have one) | Optional |
| `VITE_APP_NAME` | `SerwaaBroni` | Yes |
| `VITE_APP_CURRENCY` | `GHS` | Yes |

## Step 3: Deploy

### Option A: GitHub + Vercel (Recommended)

1. Push this project to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → "Add New Project"
3. Import your GitHub repo
4. Framework Preset: **Vite**
5. Build Command: `npm run build`
6. Output Directory: `dist`
7. Add environment variables (from Step 2)
8. Click **Deploy**

### Option B: Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
cd /path/to/serwaabroni
vercel --prod
```

## Step 4: Configure Supabase Auth Redirect

After deployment, update your Supabase Auth settings:

1. Go to Supabase Dashboard → Authentication → URL Configuration
2. Set **Site URL** to your Vercel URL (e.g., `https://serwaabroni.vercel.app`)
3. Add your Vercel URL to **Redirect URLs**

## Step 5: Enable Camera (for Production)

For the barcode scanner to work on real phones, you need HTTPS. Vercel provides this automatically.

The `Permissions-Policy` header in `index.html` already sets `camera=(self)`, which is correct for production.

## Important: SPA Routing

The `vercel.json` file in this project handles React Router. All routes redirect to `index.html`, so `/login`, `/settings`, `/stock` etc. all work correctly.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Blank page on `/login` | Check `vercel.json` is in the project root |
| Supabase connection fails | Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in Vercel |
| Camera not working | Must use HTTPS (Vercel provides this). Also check phone permissions |
| Data not persisting | Check migrations are run. Run `migration_002.sql` in Supabase SQL Editor |
