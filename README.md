# Groupie 🔍

Binance grouped times & sales.

### Requires

- [Node v18.15.0](https://nodejs.org/)
- npm v9.6.2

### Installation

```sh
npm ci
```

### Usage

```sh
node groupie.js <SYMBOL> # e.g. 1m candles 'node groupie.js BTCUSDT'
```

```sh
npm run start # BTCUSDT 1m candles
npm run start:3m # BTCUSDT 3m candles
npm run start:5m # BTCUSDT 5m candles
npm run start:15m # BTCUSDT 15m candles
```

### Options

##### `-s` / `--size`

Candle size in seconds (defaults to 60)

```sh
node groupie.js <SYMBOL> -s <seconds> # e.g. 5m candles 'node groupie.js BTCUSDT -s 300'
```
