# Discord Activity: Getting Started Guide

A template from the [Building An Activity](https://discord.com/developers/docs/activities/building-an-activity) tutorial in the Discord Developer Docs was used as the Foundation of this Project.

Read more about building Discord Activities with the Embedded App SDK at [https://discord.com/developers/docs/activities/overview](https://discord.com/developers/docs/activities/overview).

## Cloudflared

The local start task uses the named Cloudflare Tunnel `mao` instead of a Quick Tunnel. Quick Tunnels generate a new URL on every start.

Create the named tunnel once after logging in with `cloudflared login`:

```powershell
cloudflared tunnel create mao
cloudflared tunnel route dns mao mao.example.com
```

Create `%USERPROFILE%\\.cloudflared\\config.yml` with the hostname you routed:

```yaml
tunnel: mao
credentials-file: C:\\Users\\YOUR_USER\\.cloudflared\\TUNNEL_ID.json

ingress:
	- hostname: mao.example.com
		service: http://localhost:5173
	- service: http_status:404
```

Replace `mao.example.com`, `YOUR_USER`, and `TUNNEL_ID` with your values. After that, `Mao: Lokal starten` uses the same public URL every time.

## ENV-File
You have to fill the example.env file with your discord credentials and rename it to .env.
