# Shared Node Staking - Frontend

Interface for delegating to validators (Staking contract). Same stack as the main frontend repo: Next.js 16, Tailwind 4, wagmi, RainbowKit, Framer Motion.

## Running

```bash
npm install --legacy-peer-deps
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Connect your wallet to Redbelly Testnet (Chain 153).

## Configuration (env)

Create a `.env.local` file in the `frontend` directory:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_STAKING_ADDRESS` | Staking contract address |
| `NEXT_PUBLIC_TREASURY_ADDRESS` | RewardsTreasury address |
| `NEXT_PUBLIC_STAKING_TOKEN` | Staking token address (ERC20) |
| `NEXT_PUBLIC_REWARD_TOKEN` | Reward token address (may be the same) |
| `NEXT_PUBLIC_CHAIN_ID` | (optional) Network ID, default 153 |

Without these set, the UI will render but contract reads will be empty (addresses `0x0`).

## Deploy

1. **Nginx** - configure the server so that your host proxies to `http://127.0.0.1:3001` (e.g. `proxy_pass http://127.0.0.1:3001;` in the server/location block).
2. **Systemd** - copy `staking-validator-frontend.service.example` to `/etc/systemd/system/staking-validator-frontend.service`, set `User` and `WorkingDirectory` to the actual project path, then `daemon-reload`, `enable`, `start`.
3. **Deploy** - on the server (from repo root): `./new-shared-node-staking/frontend/deploy.sh`. The script runs `npm install --legacy-peer-deps`, `npm run build`, and restarts the service (port 3001).

## Features

- **Overview:** Total staked, APR, treasury balance, runway (days).
- **Validator list:** Cards with commission, total stake, saturation, Stake / Manage buttons.
- **Stake:** Modal with amount, Approve & Stake (or Stake), balance.
- **Manage:** Claim rewards, request unstake (24h delay), withdraw after unlock.

Style and animations (glass-card, ambient-bg, drift, shine, theme toggle) are consistent with the main frontend repo.
